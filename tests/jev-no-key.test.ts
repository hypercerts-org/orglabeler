import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { OrganizationSnapshot, ProfileSnapshot } from '../src/lib/types'
import type { JevFetch } from '../src/lib/jev'

const testDir = mkdtempSync(join(tmpdir(), 'orglabeler-jev-no-key-'))
process.env.ACTIVITY_DB_PATH = join(testDir, 'activity-log.db')
process.env.LABELS_DB_PATH = join(testDir, 'labels.db')
process.env.DID = 'did:example:labeler'
process.env.SIGNING_KEY = '01'.repeat(32)
process.env.TEST_PDS_HOSTS = ''
process.env.TYPESAFE_API_KEY = ''

const {
  closeDb,
  getDb,
  getJevAssessment,
  initializeJevAssessment,
  saveJevAssessment,
  upsertOrganizationSnapshot,
  upsertProfileSnapshot,
} = await import('../src/lib/db')
const { applyQualityLabel, fetchCurrentLabels, labelerServer } = await import('../src/labeler/server')
const { processOrganizationAssessment } = await import('../src/labeler/jev-assessment-worker')
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
  `)
  await labelerServer.db.execute('DELETE FROM labels')
})

function storeActor(did: string): { rkey: string; uri: string } {
  const rkey = 'self'
  const uri = `at://${did}/app.certified.actor.organization/${rkey}`
  upsertOrganizationSnapshot({
    did,
    rkey,
    recordUri: uri,
    payload: {
      $type: 'app.certified.actor.organization',
      organizationType: ['ngo'],
      createdAt: '2024-01-01T00:00:00.000Z',
    } as OrganizationSnapshot['payload'],
  })
  upsertProfileSnapshot({
    did,
    rkey: 'self',
    recordUri: `at://${did}/app.certified.actor.profile/self`,
    payload: {
      $type: 'app.certified.actor.profile',
      displayName: 'Example Organization',
      description: 'A community organization with a substantive local mission.',
      createdAt: '2024-01-01T00:00:00.000Z',
    } as ProfileSnapshot['payload'],
  })
  return { rkey, uri }
}

test('missing TypeSafe configuration is persisted without replacing an existing label', async () => {
  const did = 'did:example:awaiting-config'
  const { rkey, uri } = storeActor(did)
  await applyQualityLabel(did, 'high-quality')
  initializeJevAssessment({ did, rkey, uri, displayName: 'Example Organization', inputIdentity: 'previous-input' })
  assert.equal(saveJevAssessment({
    did,
    inputIdentity: 'previous-input',
    model: 'old-model',
    questionVersion: JEV_QUESTION_VERSION,
    policyVersion: JEV_POLICY_VERSION,
    probabilities: { test_data: { type: 'noul', noul: 0.001 } },
    status: 'assessed',
    tier: 'high-quality',
  }), true)

  let called = false
  const fetchImpl: JevFetch = async () => {
    called = true
    return new Response('{}', { status: 200 })
  }
  const outcome = await processOrganizationAssessment(did, { fetchImpl })

  assert.equal(outcome, 'awaiting-configuration')
  assert.equal(getJevAssessment(did)?.status, 'awaiting-configuration')
  assert.equal(getJevAssessment(did)?.publishedTier, 'high-quality')
  assert.equal(getJevAssessment(did)?.labelStatus, 'stale')
  assert.deepEqual([...await fetchCurrentLabels(did)], ['high-quality'])
  assert.equal(called, false)
})
