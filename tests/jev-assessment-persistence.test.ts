import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testDir = mkdtempSync(join(tmpdir(), 'orglabeler-jev-persistence-'))
process.env.ACTIVITY_DB_PATH = join(testDir, 'activity-log.db')
process.env.LABELS_DB_PATH = join(testDir, 'labels.db')

const {
  closeDb,
  claimDueRecomputeJob,
  completeRecomputeJob,
  enqueueRecomputeJob,
  getDb,
  getJevAssessment,
  getReassessmentRun,
  initializeJevAssessment,
  saveJevAssessment,
  setJevAssessmentStatus,
  startReassessmentRun,
  upsertOrganizationSnapshot,
  updateReassessmentRunItem,
} = await import('../src/lib/db')

after(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

function dueNow(): string {
  return new Date(Date.now() + 1000).toISOString()
}

test('assessment updates preserve the last published tier and mark it stale when inputs change', () => {
  upsertOrganizationSnapshot({
    did: 'did:example:one',
    rkey: 'org',
    recordUri: 'at://did:example:one/app.certified.actor.organization/org',
    payload: { $type: 'app.certified.actor.organization' } as never,
  })
  initializeJevAssessment({
    did: 'did:example:one',
    rkey: 'org',
    uri: 'at://did:example:one/app.certified.actor.organization/org',
    displayName: 'Example Organization',
    inputIdentity: 'input-v1',
  })
  assert.equal(saveJevAssessment({
    did: 'did:example:one',
    inputIdentity: 'input-v1',
    model: 'jev-1.13.0',
    questionVersion: 'questions-v1',
    policyVersion: 'policy-v1',
    probabilities: { test_data: 0.01, substantive_purpose: 0.99 },
    status: 'assessed',
    tier: 'standard',
  }), true)

  initializeJevAssessment({
    did: 'did:example:one',
    rkey: 'org',
    uri: 'at://did:example:one/app.certified.actor.organization/org',
    displayName: 'Example Organization',
    inputIdentity: 'input-v2',
  })

  const assessment = getJevAssessment('did:example:one')
  assert.equal(assessment?.inputIdentity, 'input-v2')
  assert.equal(assessment?.status, 'queued')
  assert.equal(assessment?.publishedTier, 'standard')
  assert.equal(assessment?.resultInputIdentity, 'input-v1')
  assert.equal(assessment?.labelStatus, 'stale')
  assert.equal(assessment?.probabilities?.test_data, 0.01)
})

test('assessment initialization and status updates persist ISO-8601 UTC timestamps', () => {
  const did = 'did:example:assessment-timestamps'
  const uri = `at://${did}/app.certified.actor.organization/org`
  upsertOrganizationSnapshot({
    did,
    rkey: 'org',
    recordUri: uri,
    payload: { $type: 'app.certified.actor.organization' } as never,
  })
  initializeJevAssessment({
    did,
    rkey: 'org',
    uri,
    displayName: 'Timestamp Example',
    inputIdentity: 'timestamp-input',
  })

  const initialized = getJevAssessment(did)
  assert.ok(initialized)
  assert.match(initialized.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)

  setJevAssessmentStatus(did, 'awaiting-configuration')

  const updated = getJevAssessment(did)
  assert.ok(updated)
  assert.match(updated.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
})

test('assessment result writes reject an outdated input identity', () => {
  upsertOrganizationSnapshot({
    did: 'did:example:stale',
    rkey: 'org',
    recordUri: 'at://did:example:stale/app.certified.actor.organization/org',
    payload: { $type: 'app.certified.actor.organization' } as never,
  })
  initializeJevAssessment({
    did: 'did:example:stale',
    rkey: 'org',
    uri: 'at://did:example:stale/app.certified.actor.organization/org',
    displayName: 'Example Organization',
    inputIdentity: 'current-input',
  })

  assert.equal(saveJevAssessment({
    did: 'did:example:stale',
    inputIdentity: 'old-input',
    model: 'jev-1.13.0',
    questionVersion: 'questions-v1',
    policyVersion: 'policy-v1',
    probabilities: { test_data: 0.01 },
    status: 'assessed',
    tier: 'high-quality',
  }), false)
  assert.equal(getJevAssessment('did:example:stale')?.publishedTier, null)
})

test('requeued forced assessment work retains its run identity and cannot be swallowed by completion', () => {
  enqueueRecomputeJob('recompute-org', 'did:example:queued', {
    delayMs: 0,
    payload: { force: true, runIds: ['run-1'], reason: 'admin-reassessment' },
  })
  const firstJob = claimDueRecomputeJob(dueNow())
  assert.ok(firstJob)

  enqueueRecomputeJob('recompute-org', 'did:example:queued', {
    delayMs: 0,
    payload: { reason: 'record-updated-during-inference' },
  })
  assert.equal(completeRecomputeJob(firstJob.id), 0)

  const requeued = claimDueRecomputeJob(dueNow())
  assert.ok(requeued)
  assert.deepEqual(JSON.parse(requeued.payload ?? '{}'), {
    force: true,
    runIds: ['run-1'],
    reason: 'record-updated-during-inference',
  })
  assert.equal(completeRecomputeJob(requeued.id), 1)
})

test('reassessment runs reject duplicates and expose per-organization progress', () => {
  getDb().exec('DELETE FROM organization_snapshots')
  for (const did of ['did:example:first', 'did:example:second']) {
    upsertOrganizationSnapshot({
      did,
      rkey: 'org',
      recordUri: `at://${did}/app.certified.actor.organization/org`,
      payload: { $type: 'app.certified.actor.organization' } as never,
      updatedAt: new Date().toISOString(),
    })
  }

  const started = startReassessmentRun('did:example:admin')
  assert.equal(started.started, true)
  assert.ok(started.run)
  assert.equal(started.run.total, 2)

  const duplicate = startReassessmentRun('did:example:admin')
  assert.equal(duplicate.started, false)
  assert.equal(duplicate.run?.id, started.run.id)

  updateReassessmentRunItem(started.run.id, 'did:example:first', 'completed')
  const halfway = getReassessmentRun(started.run.id)
  assert.equal(halfway?.completed, 1)
  assert.equal(halfway?.failed, 0)
  assert.equal(halfway?.status, 'running')

  updateReassessmentRunItem(started.run.id, 'did:example:second', 'failed')
  const finished = getReassessmentRun(started.run.id)
  assert.equal(finished?.completed, 2)
  assert.equal(finished?.failed, 1)
  assert.equal(finished?.status, 'completed')
})
