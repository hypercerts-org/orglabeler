import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { OrganizationSnapshot } from '../src/lib/types'

const testDir = mkdtempSync(join(tmpdir(), 'orglabeler-did-label-subjects-'))
process.env.ACTIVITY_DB_PATH = join(testDir, 'activity-log.db')
process.env.LABELS_DB_PATH = join(testDir, 'labels.db')
process.env.DID = 'did:example:labeler'
process.env.SIGNING_KEY = '01'.repeat(32)
process.env.TAP_URL = 'http://127.0.0.1:65535'
process.env.HF_TOKEN = ''

const {
  closeDb,
  getDb,
  logActivity,
  upsertOrganizationSnapshot,
} = await import('../src/lib/db')
const { fetchCurrentLabels, labelerServer } = await import('../src/labeler/server')
const { recomputeLabeledOrganizationRow, syncLabelsWithDb } = await import('../src/labeler/tap-consumer')

async function resetLabelDb(): Promise<void> {
  await (labelerServer as unknown as { dbInitLock?: Promise<void> }).dbInitLock
  await labelerServer.db.execute('DELETE FROM labels')
}

beforeEach(async () => {
  getDb().exec(`
    DELETE FROM activities;
    DELETE FROM organization_snapshots;
    DELETE FROM profile_snapshots;
    DELETE FROM pending_organization_deletes;
    DELETE FROM recompute_jobs;
    DELETE FROM actor_pds_cache;
    DELETE FROM url_checks;
  `)
  await resetLabelDb()
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

async function storedLabelSubjects(): Promise<string[]> {
  const result = await labelerServer.db.execute('SELECT uri FROM labels ORDER BY id ASC')
  return result.rows.map(row => String(row.uri))
}

test('recompute applies quality labels to the actor DID, not the organization record URI', async () => {
  const did = 'did:example:org-recompute'
  const rkey = 'self'
  const recordUri = `at://${did}/app.certified.actor.organization/${rkey}`

  upsertOrganizationSnapshot({
    did,
    rkey,
    recordUri,
    payload: organizationPayload(),
  })

  const outcome = await recomputeLabeledOrganizationRow(did)

  assert.ok(outcome)
  assert.equal(outcome.tier, 'standard')
  assert.deepEqual([...await fetchCurrentLabels(did)], ['standard'])
  assert.deepEqual([...await fetchCurrentLabels(recordUri)], [])
  assert.deepEqual(await storedLabelSubjects(), [did])
})

test('DB label sync repairs missing actor DID labels without labeling record URIs', async () => {
  const did = 'did:example:org-sync'
  const rkey = 'self'
  const recordUri = `at://${did}/app.certified.actor.organization/${rkey}`

  logActivity({
    did,
    rkey,
    uri: recordUri,
    title: 'Sync Example Organization',
    score: 80,
    tier: 'high-quality',
    breakdown: '{}',
    testSignals: '[]',
    validationNotes: [],
    labeledAt: new Date().toISOString(),
  })

  await syncLabelsWithDb()

  assert.deepEqual([...await fetchCurrentLabels(did)], ['high-quality'])
  assert.deepEqual([...await fetchCurrentLabels(recordUri)], [])
  assert.deepEqual(await storedLabelSubjects(), [did])
})
