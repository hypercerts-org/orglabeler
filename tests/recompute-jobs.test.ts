import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testDir = mkdtempSync(join(tmpdir(), 'orglabeler-recompute-jobs-'))
process.env.ACTIVITY_DB_PATH = join(testDir, 'activity-log.db')
process.env.LABELS_DB_PATH = join(testDir, 'labels.db')

const {
  claimDueRecomputeJob,
  closeDb,
  completeRecomputeJob,
  enqueueRecomputeJob,
  failRecomputeJob,
  getDb,
  getRecomputeJobCounts,
  recoverStaleRunningRecomputeJobs,
} = await import('../src/lib/db')

after(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

function dueNow(): string {
  return new Date(Date.now() + 1000).toISOString()
}

test('recompute jobs coalesce by DID and preserve newer pending work during races', () => {
  enqueueRecomputeJob('recompute-org', 'did:example:one', { delayMs: 50, payload: { reason: 'first' } })
  enqueueRecomputeJob('recompute-org', 'did:example:one', { delayMs: 0, payload: { reason: 'second' } })

  assert.equal(getRecomputeJobCounts().pending, 1)

  let job = claimDueRecomputeJob(dueNow())
  assert.ok(job)
  assert.equal(job.attempts, 1)

  enqueueRecomputeJob('recompute-org', 'did:example:one', { delayMs: 0, payload: { reason: 'raced' } })
  assert.equal(completeRecomputeJob(job.id), 0)

  job = claimDueRecomputeJob(dueNow())
  assert.ok(job)
  assert.equal(completeRecomputeJob(job.id), 1)

  enqueueRecomputeJob('recompute-org', 'did:example:two', { delayMs: 0 })
  job = claimDueRecomputeJob(dueNow())
  assert.ok(job)

  enqueueRecomputeJob('recompute-org', 'did:example:two', { delayMs: 0, payload: { reason: 'retry-race' } })
  failRecomputeJob(job.id, 'old worker failed', 60_000)

  job = claimDueRecomputeJob(dueNow())
  assert.ok(job)
  assert.equal(completeRecomputeJob(job.id), 1)

  const counts = getRecomputeJobCounts()
  assert.equal(counts.pending, 0)
  assert.equal(counts.running, 0)
  assert.equal(counts.failed, 0)
  assert.equal(counts.done, 2)
})

test('stale running recompute jobs are recovered for retry', () => {
  enqueueRecomputeJob('recompute-org', 'did:example:stale', { delayMs: 0 })

  let job = claimDueRecomputeJob(dueNow())
  assert.ok(job)

  getDb().prepare("UPDATE recompute_jobs SET updated_at = datetime('now', '-10 minutes') WHERE id = ?").run(job.id)

  assert.equal(recoverStaleRunningRecomputeJobs(5 * 60_000), 1)

  job = claimDueRecomputeJob(dueNow())
  assert.ok(job)
  assert.equal(completeRecomputeJob(job.id), 1)
})
