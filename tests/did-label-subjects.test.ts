import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { OrganizationSnapshot } from '../src/lib/types'
import type { JevFetch } from '../src/lib/jev'

const testDir = mkdtempSync(join(tmpdir(), 'orglabeler-did-label-subjects-'))
process.env.ACTIVITY_DB_PATH = join(testDir, 'activity-log.db')
process.env.LABELS_DB_PATH = join(testDir, 'labels.db')
process.env.DID = 'did:example:labeler'
process.env.SIGNING_KEY = '01'.repeat(32)
process.env.TAP_URL = 'http://127.0.0.1:65535'
process.env.TYPESAFE_API_KEY = 'test-key'
process.env.TEST_PDS_HOSTS = ''

const { JEV_POLICY_VERSION, JEV_QUESTION_VERSION } = await import('../src/lib/jev')
const {
  closeDb,
  getDb,
  getJevAssessment,
  initializeJevAssessment,
  saveJevAssessment,
  upsertOrganizationSnapshot,
} = await import('../src/lib/db')
const { fetchCurrentLabels, labelerServer } = await import('../src/labeler/server')
const { processOrganizationAssessment } = await import('../src/labeler/jev-assessment-worker')
const { syncLabelsWithDb } = await import('../src/labeler/tap-consumer')

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
    DELETE FROM jev_assessments;
    DELETE FROM reassessment_run_items;
    DELETE FROM reassessment_runs;
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

test('Jev assessment applies the quality label to the actor DID, not the organization record URI', async () => {
  const did = 'did:example:org-recompute'
  const rkey = 'self'
  const recordUri = `at://${did}/app.certified.actor.organization/${rkey}`

  upsertOrganizationSnapshot({
    did,
    rkey,
    recordUri,
    payload: organizationPayload(),
  })

  const jevReply = {
    model: 'jev-test-model',
    answers: {
      test_data: { type: 'noul', noul: 0.001 },
      substantive_purpose: { type: 'noul', noul: 0.99 },
      consistency_quality: {
        type: 'choice',
        choice: 'standard',
        confidence: 0.998,
        probabilities: { high_quality: 0.001, standard: 0.998, uncertain: 0.001 },
      },
    },
    usage: { input_tokens: 10, output_tokens: 3 },
  }
  const fetchImpl: JevFetch = async () => new Response(JSON.stringify(jevReply), { status: 200 })
  const outcome = await processOrganizationAssessment(did, { fetchImpl })

  assert.equal(outcome, 'assessed')
  assert.equal(getJevAssessment(did)?.publishedTier, 'standard')
  assert.deepEqual([...await fetchCurrentLabels(did)], ['standard'])
  assert.deepEqual([...await fetchCurrentLabels(recordUri)], [])
  assert.deepEqual(await storedLabelSubjects(), [did])
})

test('DB label sync repairs missing current Jev DID labels without labeling record URIs', async () => {
  const did = 'did:example:org-sync'
  const rkey = 'self'
  const recordUri = `at://${did}/app.certified.actor.organization/${rkey}`

  upsertOrganizationSnapshot({ did, rkey, recordUri, payload: organizationPayload() })
  initializeJevAssessment({ did, rkey, uri: recordUri, displayName: 'Sync Example Organization', inputIdentity: 'sync-input' })
  assert.equal(saveJevAssessment({
    did,
    inputIdentity: 'sync-input',
    model: 'jev-test-model',
    questionVersion: JEV_QUESTION_VERSION,
    policyVersion: JEV_POLICY_VERSION,
    probabilities: { test_data: { noul: 0.001 } },
    status: 'assessed',
    tier: 'high-quality',
  }), true)

  await syncLabelsWithDb()

  assert.deepEqual([...await fetchCurrentLabels(did)], ['high-quality'])
  assert.deepEqual([...await fetchCurrentLabels(recordUri)], [])
  assert.deepEqual(await storedLabelSubjects(), [did])
})
