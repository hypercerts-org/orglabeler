import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { OrganizationSnapshot, ProfileSnapshot } from '../src/lib/types'

const testDir = mkdtempSync(join(tmpdir(), 'orglabeler-assessment-feed-'))
process.env.ACTIVITY_DB_PATH = join(testDir, 'activity-log.db')
process.env.LABELS_DB_PATH = join(testDir, 'labels.db')
process.env.DID = 'did:example:labeler'
process.env.SIGNING_KEY = '01'.repeat(32)
process.env.TYPESAFE_API_KEY = ''

const {
  closeDb,
  getAssessmentFeedPage,
  getDb,
  getStats,
  initializeJevAssessment,
  saveJevAssessment,
  setJevAssessmentStatus,
  upsertOrganizationSnapshot,
  upsertProfileSnapshot,
} = await import('../src/lib/db')
const { JEV_POLICY_VERSION, JEV_QUESTION_VERSION } = await import('../src/lib/jev')

after(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  getDb().exec(`
    DELETE FROM profile_snapshots;
    DELETE FROM organization_snapshots;
    DELETE FROM pending_organization_deletes;
    DELETE FROM recompute_jobs;
    DELETE FROM actor_pds_cache;
    DELETE FROM url_checks;
    DELETE FROM jev_assessments;
  `)
})

function seedOrganization(did: string, displayName: string): { rkey: string; uri: string } {
  const rkey = 'self'
  const uri = `at://${did}/app.certified.actor.organization/${rkey}`
  upsertOrganizationSnapshot({
    did,
    rkey,
    recordUri: uri,
    payload: {
      $type: 'app.certified.actor.organization',
      organizationType: ['nonprofit'],
      createdAt: '2024-01-01T00:00:00.000Z',
    } as OrganizationSnapshot['payload'],
  })
  upsertProfileSnapshot({
    did,
    rkey: 'self',
    recordUri: `at://${did}/app.certified.actor.profile/self`,
    payload: {
      $type: 'app.certified.actor.profile',
      displayName,
      createdAt: '2024-01-01T00:00:00.000Z',
    } as ProfileSnapshot['payload'],
  })
  initializeJevAssessment({ did, rkey, uri, displayName, inputIdentity: `input-${did}` })
  return { rkey, uri }
}

function saveResult(did: string, tier: 'standard' | 'high-quality' | null, status: 'assessed' | 'uncertain' = 'assessed'): void {
  assert.equal(saveJevAssessment({
    did,
    inputIdentity: `input-${did}`,
    model: 'jev-test-model',
    questionVersion: JEV_QUESTION_VERSION,
    policyVersion: JEV_POLICY_VERSION,
    probabilities: {
      test_data: { type: 'noul', noul: 0.001 },
      consistency_quality: { choice: tier ?? 'uncertain', confidence: 0.99 },
    },
    status,
    tier,
  }), true)
}

test('assessment feed filters published tiers and searches actor display names', () => {
  const uncertainDid = 'did:example:forest-one'
  seedOrganization(uncertainDid, 'Forest Recovery One')
  saveResult(uncertainDid, null, 'uncertain')

  const standardDid = 'did:example:forest-two'
  seedOrganization(standardDid, 'Forest Recovery Two')
  saveResult(standardDid, 'standard')

  const staleDid = 'did:example:forest-three'
  const stale = seedOrganization(staleDid, 'Forest Recovery Three')
  saveResult(staleDid, 'high-quality')
  initializeJevAssessment({
    did: staleDid,
    rkey: stale.rkey,
    uri: stale.uri,
    displayName: 'Forest Recovery Three',
    inputIdentity: 'changed-input',
  })

  const standard = getAssessmentFeedPage({ tier: 'standard', query: 'Forest Recovery', limit: 10 })
  assert.equal(standard.total, 1)
  assert.equal(standard.assessments.length, 1)
  assert.equal(standard.assessments[0]?.did, standardDid)

  const uncertain = getAssessmentFeedPage({ query: 'forest-one' })
  assert.equal(uncertain.total, 1)
  assert.equal(uncertain.assessments[0]?.status, 'uncertain')
  assert.equal(uncertain.assessments[0]?.publishedTier, null)
  assert.deepEqual(uncertain.assessments[0]?.probabilities, {
    test_data: { type: 'noul', noul: 0.001 },
    consistency_quality: { choice: 'uncertain', confidence: 0.99 },
  })

  const staleEntry = getAssessmentFeedPage({ query: 'forest-three' }).assessments[0]
  assert.equal(staleEntry?.publishedTier, 'high-quality')
  assert.equal(staleEntry?.labelStatus, 'stale')
  assert.equal(staleEntry?.probabilities, null)
})

test('assessment feed does not expose internal provider errors', () => {
  const did = 'did:example:failed-feed-entry'
  seedOrganization(did, 'Failed Feed Entry')
  setJevAssessmentStatus(did, 'failed', 'TypeSafe API returned HTTP 503')

  const entry = getAssessmentFeedPage({ query: did }).assessments[0]
  assert.equal(entry?.status, 'failed')
  assert.equal(entry && 'lastError' in entry, false)
})

test('assessment feed paginates and stats count published tiers separately from uncertain status', () => {
  const records = [
    ['did:example:feed-a', 'Feed A', null, 'uncertain'] as const,
    ['did:example:feed-b', 'Feed B', 'standard', 'assessed'] as const,
    ['did:example:feed-c', 'Feed C', 'high-quality', 'assessed'] as const,
  ]
  for (const [did, name, tier, status] of records) {
    seedOrganization(did, name)
    saveResult(did, tier, status)
  }

  const firstPage = getAssessmentFeedPage({ limit: 1, offset: 0 })
  const secondPage = getAssessmentFeedPage({ limit: 1, offset: 1 })
  assert.equal(firstPage.total, 3)
  assert.equal(firstPage.assessments.length, 1)
  assert.equal(secondPage.total, 3)
  assert.equal(secondPage.assessments.length, 1)
  assert.notEqual(firstPage.assessments[0]?.did, secondPage.assessments[0]?.did)

  const stats = getStats()
  assert.equal(stats.total, 3)
  assert.equal(stats.byTier.standard, 1)
  assert.equal(stats.byTier['high-quality'], 1)
  assert.equal(stats.byTier['likely-test'], 0)
  assert.equal(stats.byAssessmentStatus.uncertain, 1)
  assert.equal(stats.byAssessmentStatus.assessed, 2)
})
