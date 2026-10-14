import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { OrganizationSnapshot, ProfileSnapshot } from '../src/lib/types'

const testDir = mkdtempSync(join(tmpdir(), 'orglabeler-url-pds-gate-'))
process.env.ACTIVITY_DB_PATH = join(testDir, 'activity-log.db')
process.env.LABELS_DB_PATH = join(testDir, 'labels.db')
process.env.TEST_PDS_HOSTS = 'epds1.test.certified.app'
process.env.URL_ENRICHMENT_ENABLED = 'true'
process.env.URL_CHECK_INTERVAL_MS = '60000'
process.env.URL_CHECK_DISCOVERY_INTERVAL_MS = '60000'
process.env.URL_CHECK_HARD_FAILURE_ATTEMPTS = '1'

const {
  closeDb,
  getDb,
  getDueUrlCheck,
  getPersistedUrlResolutionMap,
  getRecomputeJobCounts,
  getUrlResolutionMap,
  recordActorPdsOk,
  recordUrlCheckOk,
  upsertOrganizationSnapshot,
  upsertPendingUrlCheck,
  upsertProfileSnapshot,
} = await import('../src/lib/db')
const { enqueueUrlChecksForDid, startUrlEnrichmentWorker } = await import('../src/labeler/url-enrichment-worker')

after(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  getDb().exec(`
    DELETE FROM actor_pds_cache;
    DELETE FROM recompute_jobs;
    DELETE FROM url_checks;
    DELETE FROM jev_assessments;
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

test('URL rechecks preserve the before-state for matching results and schedule changed evidence', async () => {
  const did = 'did:plc:url-recheck'
  const url = 'https://8.8.8.8/'
  upsertOrganizationSnapshot({
    did,
    rkey: 'self',
    recordUri: `at://${did}/app.certified.actor.organization/self`,
    payload: {
      $type: 'app.certified.actor.organization',
      organizationType: ['ngo'],
      urls: [],
      createdAt: '2024-01-01T00:00:00.000Z',
    } as OrganizationSnapshot['payload'],
  })
  upsertProfileSnapshot({
    did,
    rkey: 'self',
    recordUri: `at://${did}/app.certified.actor.profile/self`,
    payload: {
      $type: 'app.certified.actor.profile',
      displayName: 'URL Recheck Example',
      website: url,
      createdAt: '2024-01-01T00:00:00.000Z',
    } as ProfileSnapshot['payload'],
  })
  recordActorPdsOk(did, 'https://pds.example', 'pds.example', 60_000)
  upsertPendingUrlCheck(url)
  recordUrlCheckOk(url, 200, -1000)
  upsertPendingUrlCheck(url)
  assert.deepEqual(getPersistedUrlResolutionMap([url]), { [url]: 'ok' })

  const originalFetch = globalThis.fetch
  let responseStatus = 200
  globalThis.fetch = async () => new Response(null, { status: responseStatus })
  const waitFor = async (condition: () => boolean, message: string): Promise<void> => {
    const deadline = Date.now() + 2_000
    while (Date.now() < deadline && !condition()) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    assert.ok(condition(), message)
  }

  try {
    const sameStatusWorker = startUrlEnrichmentWorker()
    try {
      await waitFor(
        () => getDueUrlCheck() === null && getUrlResolutionMap([url])[url] === 'ok',
        'same-status URL recheck did not finish',
      )
      assert.equal(getRecomputeJobCounts().pending, 0)
    } finally {
      sameStatusWorker.destroy()
    }

    recordUrlCheckOk(url, 200, -1000)
    upsertPendingUrlCheck(url)
    responseStatus = 404

    const changedStatusWorker = startUrlEnrichmentWorker()
    try {
      await waitFor(
        () => getDueUrlCheck() === null
          && getUrlResolutionMap([url])[url] === 'failed'
          && getRecomputeJobCounts().pending === 1,
        'changed URL resolution did not queue a reassessment',
      )
    } finally {
      changedStatusWorker.destroy()
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('URL enrichment is deferred for stale PDS cache rows', () => {
  const did = 'did:plc:stalepds'
  upsertOrganization(did)
  recordActorPdsOk(did, 'https://bsky.social', 'bsky.social', -1000)

  assert.equal(enqueueUrlChecksForDid(did), 0)
  assert.equal(getDueUrlCheck(), null)
  assert.equal(getRecomputeJobCounts().pending, 1)
})
