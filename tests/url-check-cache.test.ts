import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testDir = mkdtempSync(join(tmpdir(), 'orglabeler-url-checks-'))
process.env.ACTIVITY_DB_PATH = join(testDir, 'activity-log.db')
process.env.LABELS_DB_PATH = join(testDir, 'labels.db')

const {
  closeDb,
  getDb,
  getDueUrlCheck,
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
