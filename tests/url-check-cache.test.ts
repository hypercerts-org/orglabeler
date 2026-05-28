import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scoreActivity } from '../src/lib/scorer'
import type { MergedScoringInput } from '../src/lib/scoring-input'

const testDir = mkdtempSync(join(tmpdir(), 'orglabeler-url-checks-'))
process.env.ACTIVITY_DB_PATH = join(testDir, 'activity-log.db')
process.env.LABELS_DB_PATH = join(testDir, 'labels.db')

const {
  closeDb,
  getDb,
  getDueUrlCheck,
  getUrlResolutionMap,
  recordUrlCheckFailure,
  recordUrlCheckOk,
  upsertPendingUrlCheck,
} = await import('../src/lib/db')

beforeEach(() => {
  getDb().exec('DELETE FROM url_checks')
})

after(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

test('rediscovery preserves pending URL attempts so hard failures can converge', () => {
  const url = 'https://missing.example.org/'

  upsertPendingUrlCheck(url)
  recordUrlCheckFailure({
    normalizedUrl: url,
    status: 'pending',
    resolvable: null,
    statusCode: 404,
    error: 'HTTP 404',
    attempts: 1,
    retryAfterMs: -1000,
  })

  upsertPendingUrlCheck(url)

  const due = getDueUrlCheck()
  assert.ok(due)
  assert.equal(due.normalizedUrl, url)
  assert.equal(due.status, 'pending')
  assert.equal(due.attempts, 1)
  assert.equal(due.statusCode, 404)
})

test('expired ok URL checks are refreshed as new pending checks', () => {
  const url = 'https://stale.example.org/'

  upsertPendingUrlCheck(url)
  recordUrlCheckOk(url, 200, -1000)
  upsertPendingUrlCheck(url)

  const due = getDueUrlCheck()
  assert.ok(due)
  assert.equal(due.normalizedUrl, url)
  assert.equal(due.status, 'pending')
  assert.equal(due.attempts, 0)
  assert.equal(due.statusCode, null)
})

test('failed URL cache state removes provisional URL resolve points', async () => {
  const url = 'https://example.org/'
  const base: MergedScoringInput = {
    did: 'did:example:score',
    displayName: 'Example Org',
    displayNameSource: 'profile',
    profileDisplayName: 'Example Org',
    profileDescription: 'A real organization',
    profileWebsite: url,
    validationNotes: [],
    hasAvatar: false,
    hasBanner: false,
    organizationType: ['ngo'],
    urls: [{ url, label: 'Website' }],
    location: null,
    foundedDate: null,
  }

  upsertPendingUrlCheck(url)
  assert.deepEqual(getUrlResolutionMap([url]), {})

  const optimistic = await scoreActivity(base)

  recordUrlCheckFailure({
    normalizedUrl: url,
    status: 'failed',
    resolvable: false,
    statusCode: 404,
    error: 'HTTP 404',
    attempts: 2,
    retryAfterMs: 60_000,
  })

  assert.deepEqual(getUrlResolutionMap([url]), { [url]: 'failed' })

  const failed = await scoreActivity({ ...base, urlResolution: { [url]: 'failed' } })
  assert.ok(optimistic.totalScore > failed.totalScore)
})
