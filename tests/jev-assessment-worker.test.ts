import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { JevFetch } from '../src/lib/jev'
import type { OrganizationSnapshot, ProfileSnapshot } from '../src/lib/types'
import { normalizePublicWebsiteUrl } from '../src/lib/website-utils'

const testDir = mkdtempSync(join(tmpdir(), 'orglabeler-jev-worker-'))
process.env.ACTIVITY_DB_PATH = join(testDir, 'activity-log.db')
process.env.LABELS_DB_PATH = join(testDir, 'labels.db')
process.env.DID = 'did:example:labeler'
process.env.SIGNING_KEY = '01'.repeat(32)
process.env.TAP_URL = 'http://127.0.0.1:65535'
process.env.TEST_PDS_HOSTS = ''
process.env.TYPESAFE_API_KEY = 'test-key'

const {
  closeDb,
  getDb,
  getJevAssessment,
  getRecomputeJobCounts,
  initializeJevAssessment,
  recordActorPdsOk,
  recordUrlCheckOk,
  saveJevAssessment,
  setJevAssessmentStatus,
  upsertOrganizationSnapshot,
  upsertPendingOrganizationDelete,
  upsertPendingUrlCheck,
  upsertProfileSnapshot,
  deleteOrganizationRecordState,
} = await import('../src/lib/db')
const { fetchCurrentLabels, labelerServer, applyQualityLabel } = await import('../src/labeler/server')
const {
  processOrganizationAssessment,
  queueSavedOrganizationsNeedingAssessment,
} = await import('../src/labeler/jev-assessment-worker')
const { JEV_POLICY_VERSION, JEV_QUESTION_VERSION } = await import('../src/lib/jev')

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
    DELETE FROM reassessment_run_items;
    DELETE FROM reassessment_runs;
  `)
  await labelerServer.db.execute('DELETE FROM labels')
})

function organizationPayload(): OrganizationSnapshot['payload'] {
  return {
    $type: 'app.certified.actor.organization',
    organizationType: ['nonprofit'],
    urls: [{ label: 'Project site', url: 'https://example.org/projects' }],
    createdAt: '2024-01-01T00:00:00.000Z',
  }
}

function profilePayload(description = 'Restoring native forests with local communities.'): ProfileSnapshot['payload'] {
  return {
    $type: 'app.certified.actor.profile',
    displayName: 'Forest Recovery Collective',
    description,
    website: 'https://example.org',
    createdAt: '2024-01-01T00:00:00.000Z',
  }
}

function storeActor(did: string): { rkey: string; uri: string } {
  const rkey = 'self'
  const uri = `at://${did}/app.certified.actor.organization/${rkey}`
  upsertOrganizationSnapshot({ did, rkey, recordUri: uri, payload: organizationPayload() })
  upsertProfileSnapshot({
    did,
    rkey: 'self',
    recordUri: `at://${did}/app.certified.actor.profile/self`,
    payload: profilePayload(),
    validationNotes: [],
  })
  return { rkey, uri }
}

function reply(tier: 'standard' | 'high_quality' | 'uncertain' = 'standard', testProbability = 0.001): unknown {
  const quality = tier === 'uncertain'
    ? { choice: 'uncertain', confidence: 0.9, probabilities: { high_quality: 0.05, standard: 0.05, uncertain: 0.9 } }
    : tier === 'high_quality'
      ? { choice: 'high_quality', confidence: 0.998, probabilities: { high_quality: 0.998, standard: 0.001, uncertain: 0.001 } }
      : { choice: 'standard', confidence: 0.998, probabilities: { high_quality: 0.001, standard: 0.998, uncertain: 0.001 } }

  return {
    model: 'jev-test-model',
    answers: {
      test_data: { type: 'noul', noul: testProbability },
      substantive_purpose: { type: 'noul', noul: 0.99 },
      consistency_quality: { type: 'choice', ...quality },
    },
    usage: { input_tokens: 100, output_tokens: 10 },
  }
}

function fakeFetch(body: unknown, beforeReply?: () => void): JevFetch {
  return async () => {
    beforeReply?.()
    return new Response(JSON.stringify(body), { status: 200 })
  }
}

test('record changes during inference discard the result and retain queued work', async () => {
  const did = 'did:example:changed-during-inference'
  storeActor(did)

  const outcome = await processOrganizationAssessment(did, {
    fetchImpl: fakeFetch(reply('high_quality'), () => {
      upsertProfileSnapshot({
        did,
        rkey: 'self',
        recordUri: `at://${did}/app.certified.actor.profile/self`,
        payload: profilePayload('The profile changed while Jev was evaluating it.'),
        validationNotes: [],
      })
    }),
  })

  assert.equal(outcome, 'stale')
  assert.equal(getJevAssessment(did)?.publishedTier, null)
  assert.equal(getJevAssessment(did)?.status, 'queued')
  assert.equal(getRecomputeJobCounts().pending, 1)
  assert.deepEqual([...await fetchCurrentLabels(did)], [])
})

test('URL evidence changes during inference discard the result and retain queued work', async () => {
  const did = 'did:example:url-changed-during-inference'
  storeActor(did)
  const normalizedUrl = normalizePublicWebsiteUrl('https://example.org')
  assert.ok(normalizedUrl)
  upsertPendingUrlCheck(normalizedUrl)

  const outcome = await processOrganizationAssessment(did, {
    fetchImpl: fakeFetch(reply('high_quality'), () => {
      recordUrlCheckOk(normalizedUrl, 200, 60_000)
    }),
  })

  assert.equal(outcome, 'stale')
  assert.equal(getJevAssessment(did)?.publishedTier, null)
  assert.equal(getJevAssessment(did)?.status, 'queued')
  assert.deepEqual([...await fetchCurrentLabels(did)], [])
})

test('deletion during inference prevents a late result from publishing a DID label', async () => {
  const did = 'did:example:deleted-during-inference'
  const { rkey, uri } = storeActor(did)

  const outcome = await processOrganizationAssessment(did, {
    fetchImpl: fakeFetch(reply('high_quality'), () => {
      upsertPendingOrganizationDelete(did, rkey, uri)
      deleteOrganizationRecordState(did, rkey)
    }),
  })

  assert.equal(outcome, 'deleted')
  assert.equal(getJevAssessment(did)?.publishedTier, null)
  assert.deepEqual([...await fetchCurrentLabels(did)], [])
})

test('uncertain output stores probabilities without replacing an existing published label', async () => {
  const did = 'did:example:uncertain'
  const { rkey, uri } = storeActor(did)
  await applyQualityLabel(did, 'standard')
  initializeJevAssessment({ did, rkey, uri, displayName: 'Forest Recovery Collective', inputIdentity: 'old-input' })
  assert.equal(savePreviousStandard(did), true)

  const outcome = await processOrganizationAssessment(did, {
    fetchImpl: fakeFetch(reply('uncertain')),
  })

  const assessment = getJevAssessment(did)
  assert.equal(outcome, 'uncertain')
  assert.equal(assessment?.status, 'uncertain')
  assert.equal(assessment?.publishedTier, 'standard')
  assert.equal(assessment?.labelStatus, 'stale')
  assert.deepEqual([...await fetchCurrentLabels(did)], ['standard'])
})

function savePreviousStandard(did: string): boolean {
  const assessment = getJevAssessment(did)
  if (!assessment) return false
  return saveJevAssessment({
    did,
    inputIdentity: assessment.inputIdentity,
    model: 'previous-jev-model',
    questionVersion: JEV_QUESTION_VERSION,
    policyVersion: JEV_POLICY_VERSION,
    probabilities: { test_data: { type: 'noul', noul: 0.001 } },
    status: 'assessed',
    tier: 'standard',
  })
}

test('forced reassessment calls Jev again even when the saved result has the same input identity', async () => {
  const did = 'did:example:forced-reassessment'
  storeActor(did)
  let calls = 0
  const fetchImpl = fakeFetch(reply('standard'), () => { calls++ })

  assert.equal(await processOrganizationAssessment(did, { fetchImpl }), 'assessed')
  assert.equal(await processOrganizationAssessment(did, { fetchImpl }), 'cached')
  assert.equal(await processOrganizationAssessment(did, { fetchImpl, force: true }), 'assessed')
  assert.equal(calls, 2)
})

test('startup catch-up queues saved organizations awaiting configuration after the key is added', () => {
  const did = 'did:example:startup-catchup'
  const { rkey, uri } = storeActor(did)
  initializeJevAssessment({ did, rkey, uri, displayName: 'Forest Recovery Collective', inputIdentity: 'legacy-input' })
  setJevAssessmentStatus(did, 'awaiting-configuration')

  assert.equal(queueSavedOrganizationsNeedingAssessment(), 1)
  assert.equal(getRecomputeJobCounts().pending, 1)
  assert.equal(getJevAssessment(did)?.status, 'queued')
})

test('provider failure persists a bounded error and failed assessment status', async () => {
  const did = 'did:example:provider-failure'
  storeActor(did)
  const fetchImpl: JevFetch = async () => new Response('sensitive body', { status: 503 })

  await assert.rejects(processOrganizationAssessment(did, { fetchImpl }), /HTTP 503/)
  const assessment = getJevAssessment(did)
  assert.equal(assessment?.status, 'failed')
  assert.match(assessment?.lastError ?? '', /HTTP 503/)
  assert.doesNotMatch(assessment?.lastError ?? '', /sensitive body/)
})
