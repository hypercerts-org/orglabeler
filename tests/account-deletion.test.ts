import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setImmediate } from 'node:timers/promises'
import type { OrganizationSnapshot } from '../src/lib/types'

const testDir = mkdtempSync(join(tmpdir(), 'orglabeler-account-deletion-'))
process.env.ACTIVITY_DB_PATH = join(testDir, 'activity-log.db')
process.env.LABELS_DB_PATH = join(testDir, 'labels.db')
process.env.DID = 'did:example:labeler'
process.env.SIGNING_KEY = '01'.repeat(32)
process.env.TAP_URL = 'http://127.0.0.1:65535'
process.env.HF_TOKEN = ''

const {
  claimDueRecomputeJob,
  closeDb,
  enqueueRecomputeJob,
  getDb,
  getActorPdsCache,
  getOrganizationSnapshot,
  getProfileSnapshot,
  hasPendingOrganizationDelete,
  logActivity,
  recordActorPdsOk,
  upsertOrganizationSnapshot,
  upsertProfileSnapshot,
} = await import('../src/lib/db')
const { fetchCurrentLabels, labelerServer } = await import('../src/labeler/server')
const { handleIdentityEvent, reconcileStoredOrganizationSnapshots, startRecomputeWorker } = await import('../src/labeler/tap-consumer')

beforeEach(async () => {
  getDb().exec(`
    DELETE FROM activities;
    DELETE FROM organization_snapshots;
    DELETE FROM profile_snapshots;
    DELETE FROM pending_organization_deletes;
    DELETE FROM recompute_jobs;
    DELETE FROM actor_pds_cache;
  `)
  await (labelerServer as unknown as { dbInitLock?: Promise<void> }).dbInitLock
  await labelerServer.db.execute('DELETE FROM labels')
})

after(() => {
  labelerServer.db.close()
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

function organizationPayload(): OrganizationSnapshot['payload'] {
  return {
    $type: 'app.certified.actor.organization',
    organizationType: ['ngo'],
    createdAt: '2024-01-01T00:00:00.000Z',
  }
}

/** Stores what the labeler holds for a scored, labeled organization. */
async function seedLabeledOrganization(did: string): Promise<void> {
  const recordUri = `at://${did}/app.certified.actor.organization/self`
  upsertProfileSnapshot({
    did,
    recordUri: `at://${did}/app.certified.actor.profile/self`,
    rkey: 'self',
    payload: { displayName: 'Example Organization' } as never,
    validationNotes: [],
  })
  upsertOrganizationSnapshot({ did, rkey: 'self', recordUri, payload: organizationPayload() })
  logActivity({
    did,
    rkey: 'self',
    uri: recordUri,
    title: 'Example Organization',
    score: 80,
    tier: 'high-quality',
    breakdown: '{}',
    testSignals: '[]',
    validationNotes: [],
    labeledAt: new Date().toISOString(),
  })
  recordActorPdsOk(did, 'https://pds.example', 'pds.example', 60_000)
  enqueueRecomputeJob('recompute-org', did, { delayMs: 60_000 })
  await labelerServer.createLabel({ uri: did, val: 'high-quality' })
}

function storedRows(did: string): number {
  const db = getDb()
  return ['profile_snapshots', 'organization_snapshots', 'activities', 'actor_pds_cache']
    .map(table => (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE did = ?`).get(did) as { n: number }).n)
    .reduce((sum, n) => sum + n, 0)
    + (db.prepare('SELECT COUNT(*) AS n FROM recompute_jobs WHERE key = ?').get(did) as { n: number }).n
}

test('a deleted account loses its stored state and, once the worker runs, its labels', async () => {
  const did = 'did:example:deleted-org'
  const kept = 'did:example:kept-org'
  await seedLabeledOrganization(did)
  await seedLabeledOrganization(kept)

  await handleIdentityEvent({ did, status: 'deleted' })

  assert.equal(storedRows(did), 0)
  assert.equal(getProfileSnapshot(did), null)
  assert.equal(getOrganizationSnapshot(did), null)
  assert.equal(hasPendingOrganizationDelete(did), true, 'label negation is queued')
  assert.equal(storedRows(kept), 5)
  assert.equal(hasPendingOrganizationDelete(kept), false)

  // The pending delete negates the DID's label and then removes itself.
  await reconcileStoredOrganizationSnapshots()
  assert.deepEqual([...await fetchCurrentLabels(did)], [])
  assert.equal(hasPendingOrganizationDelete(did), false)
  assert.equal((await fetchCurrentLabels(kept)).size, 1)
})

for (const [result, invalidation] of [
  ['success', 'purge'],
  ['failure', 'purge'],
  ['success', 'replacement'],
  ['failure', 'replacement'],
  ['failure', 'requeue'],
] as const) {
  test(`ignores PDS lookup ${result} after ${invalidation}`, { timeout: 3000 }, async (t) => {
    const did = 'did:web:lookup.example'
    const started = Promise.withResolvers<void>()
    const lookup = Promise.withResolvers<Response>()
    t.mock.method(globalThis, 'fetch', (url: string) => {
      assert.equal(url, 'https://lookup.example/.well-known/did.json')
      started.resolve()
      return lookup.promise
    })

    const readJobs = () => getDb().prepare('SELECT * FROM recompute_jobs ORDER BY id').all()
    enqueueRecomputeJob('resolve-actor-pds', did, { delayMs: 0 })
    const worker = startRecomputeWorker()
    try {
      await started.promise
      const [original] = readJobs() as Array<{ id: number }>
      if (invalidation !== 'requeue') {
        await handleIdentityEvent({ did, status: 'deleted' })
      }
      if (invalidation === 'replacement') {
        enqueueRecomputeJob('resolve-actor-pds', did, { delayMs: 0 })
        // Claim an identical replacement while the original lookup still waits.
        assert.equal(claimDueRecomputeJob()?.id, original.id, 'SQLite reused the row ID')
      } else if (invalidation === 'requeue') {
        enqueueRecomputeJob('resolve-actor-pds', did, { delayMs: 60_000 })
      }
      const expectedJobs = readJobs()

      lookup.resolve(result === 'success'
        ? Response.json({ service: [{ id: '#atproto_pds', serviceEndpoint: 'https://pds.example' }] })
        : new Response(null, { status: 503 }))
      // The synthetic response and SQLite writes settle before the next macrotask.
      await setImmediate()

      assert.deepEqual(readJobs(), expectedJobs, 'must not enqueue, complete or retry any job')
      assert.equal(getActorPdsCache(did), null)
    } finally {
      lookup.resolve(new Response(null, { status: 503 }))
      worker.destroy()
    }
  })
}

test('deactivation, takedown and suspension keep the account and its labels', async () => {
  for (const status of ['deactivated', 'takendown', 'suspended', 'active'] as const) {
    const did = `did:example:${status}-org`
    await seedLabeledOrganization(did)

    await handleIdentityEvent({ did, status })

    assert.equal(storedRows(did), 5, `${status} must not purge`)
    assert.equal(hasPendingOrganizationDelete(did), false)
    assert.deepEqual([...await fetchCurrentLabels(did)], ['high-quality'])
  }
})
