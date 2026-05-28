import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { OrganizationSnapshot } from '../src/lib/types'

const testDir = mkdtempSync(join(tmpdir(), 'orglabeler-url-pds-gate-'))
process.env.ACTIVITY_DB_PATH = join(testDir, 'activity-log.db')
process.env.LABELS_DB_PATH = join(testDir, 'labels.db')
process.env.TEST_PDS_HOSTS = 'epds1.test.certified.app'

const {
  closeDb,
  getDb,
  getDueUrlCheck,
  getRecomputeJobCounts,
  recordActorPdsOk,
  upsertOrganizationSnapshot,
} = await import('../src/lib/db')
const { enqueueUrlChecksForDid } = await import('../src/labeler/url-enrichment-worker')

after(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  getDb().exec(`
    DELETE FROM actor_pds_cache;
    DELETE FROM recompute_jobs;
    DELETE FROM url_checks;
    DELETE FROM organization_snapshots;
    DELETE FROM profile_snapshots;
  `)
})

function upsertOrganization(did: string): void {
  upsertOrganizationSnapshot({
    did,
    rkey: 'self',
    recordUri: `at://${did}/app.certified.actor.organization/self`,
    payload: {
      $type: 'app.certified.actor.organization',
      organizationType: ['ngo'],
      urls: [{ url: 'https://forest-recovery.example.coop', label: 'Website' }],
      createdAt: '2024-01-01T00:00:00.000Z',
    } as OrganizationSnapshot['payload'],
  })
}

test('URL enrichment is deferred until actor PDS cache is known when TEST_PDS_HOSTS is configured', () => {
  const did = 'did:plc:unknownpds'
  upsertOrganization(did)

  assert.equal(enqueueUrlChecksForDid(did), 0)
  assert.equal(getDueUrlCheck(), null)
  assert.equal(getRecomputeJobCounts().pending, 1)
})

test('URL enrichment is skipped for actors on configured test PDS hosts', () => {
  const did = 'did:plc:testpds'
  upsertOrganization(did)
  recordActorPdsOk(did, 'https://epds1.test.certified.app', 'epds1.test.certified.app', 60_000)

  assert.equal(enqueueUrlChecksForDid(did), 0)
  assert.equal(getDueUrlCheck(), null)
  assert.equal(getRecomputeJobCounts().pending, 0)
})

test('URL enrichment runs for actors on fresh non-test PDS hosts', () => {
  const did = 'did:plc:prod'
  upsertOrganization(did)
  recordActorPdsOk(did, 'https://bsky.social', 'bsky.social', 60_000)

  assert.equal(enqueueUrlChecksForDid(did), 1)

  const due = getDueUrlCheck()
  assert.ok(due)
  assert.equal(due.normalizedUrl, 'https://forest-recovery.example.coop/')
})

test('URL enrichment is deferred for stale PDS cache rows', () => {
  const did = 'did:plc:stalepds'
  upsertOrganization(did)
  recordActorPdsOk(did, 'https://bsky.social', 'bsky.social', -1000)

  assert.equal(enqueueUrlChecksForDid(did), 0)
  assert.equal(getDueUrlCheck(), null)
  assert.equal(getRecomputeJobCounts().pending, 1)
})
