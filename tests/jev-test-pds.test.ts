import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { JevFetch } from '../src/lib/jev'
import type { OrganizationSnapshot } from '../src/lib/types'

const testDir = mkdtempSync(join(tmpdir(), 'orglabeler-jev-test-pds-'))
process.env.ACTIVITY_DB_PATH = join(testDir, 'activity-log.db')
process.env.LABELS_DB_PATH = join(testDir, 'labels.db')
process.env.DID = 'did:example:labeler'
process.env.SIGNING_KEY = '01'.repeat(32)
process.env.TEST_PDS_HOSTS = 'test-pds.example'
process.env.TYPESAFE_API_KEY = ''

const {
  closeDb,
  getDb,
  getJevAssessment,
  getRecomputeJobCounts,
  recordActorPdsOk,
  upsertOrganizationSnapshot,
} = await import('../src/lib/db')
const { fetchCurrentLabels, labelerServer } = await import('../src/labeler/server')
const { processOrganizationAssessment } = await import('../src/labeler/jev-assessment-worker')

after(() => {
  labelerServer.db.close()
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(async () => {
  getDb().exec(`
    DELETE FROM activities;
    DELETE FROM profile_snapshots;
    DELETE FROM organization_snapshots;
    DELETE FROM pending_organization_deletes;
    DELETE FROM recompute_jobs;
    DELETE FROM actor_pds_cache;
    DELETE FROM url_checks;
    DELETE FROM jev_assessments;
  `)
  await labelerServer.db.execute('DELETE FROM labels')
})

function storeOrganization(did: string): string {
  const uri = `at://${did}/app.certified.actor.organization/self`
  upsertOrganizationSnapshot({
    did,
    rkey: 'self',
    recordUri: uri,
    payload: {
      $type: 'app.certified.actor.organization',
      organizationType: ['nonprofit'],
      createdAt: '2024-01-01T00:00:00.000Z',
    } as OrganizationSnapshot['payload'],
  })
  return uri
}

test('configured test-PDS actors receive likely-test without calling Jev or requiring a key', async () => {
  const did = 'did:example:test-pds-actor'
  const uri = storeOrganization(did)
  recordActorPdsOk(did, 'https://test-pds.example', 'test-pds.example', 60_000)

  let providerCalled = false
  const fetchImpl: JevFetch = async () => {
    providerCalled = true
    return new Response('{}', { status: 200 })
  }
  const outcome = await processOrganizationAssessment(did, { fetchImpl })

  assert.equal(outcome, 'assessed')
  assert.equal(providerCalled, false)
  assert.equal(getJevAssessment(did)?.publishedTier, 'likely-test')
  assert.equal(getJevAssessment(did)?.labelStatus, 'current')
  assert.deepEqual([...await fetchCurrentLabels(did)], ['likely-test'])
  assert.deepEqual([...await fetchCurrentLabels(uri)], [])
})

test('configured test-PDS policy waits for resolution instead of classifying an unknown host', async () => {
  const did = 'did:example:unresolved-pds-actor'
  storeOrganization(did)

  let providerCalled = false
  const fetchImpl: JevFetch = async () => {
    providerCalled = true
    return new Response('{}', { status: 200 })
  }
  const outcome = await processOrganizationAssessment(did, { fetchImpl })

  assert.equal(outcome, 'awaiting-pds-resolution')
  assert.equal(getJevAssessment(did)?.status, 'awaiting-pds-resolution')
  assert.equal(getJevAssessment(did)?.publishedTier, null)
  assert.equal(getRecomputeJobCounts().pending, 1)
  assert.equal(providerCalled, false)
})
