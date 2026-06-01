import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scoreActivity, tierForScore } from '../src/lib/scorer'
import type { MergedScoringInput } from '../src/lib/scoring-input'

function sparseRecord(overrides: Partial<MergedScoringInput> = {}): MergedScoringInput {
  return {
    did: 'did:plc:sparsetiering',
    displayName: 'sparsetiering…',
    displayNameSource: 'did',
    profileDisplayName: null,
    profileDescription: null,
    profileWebsite: null,
    validationNotes: [],
    hasAvatar: false,
    hasBanner: false,
    organizationType: [],
    urls: [],
    location: null,
    foundedDate: null,
    ...overrides,
  }
}

function completeRecord(overrides: Partial<MergedScoringInput> = {}): MergedScoringInput {
  return {
    did: 'did:plc:completetiering',
    displayName: 'Forest Recovery Collective',
    displayNameSource: 'profile',
    profileDisplayName: 'Forest Recovery Collective',
    profileDescription: 'A community organization restoring native forest habitats.',
    profileWebsite: 'https://forestrecovery.org',
    validationNotes: [],
    hasAvatar: true,
    hasBanner: true,
    organizationType: ['nonprofit'],
    urls: [{ url: 'https://forestrecovery.org/projects', label: 'Projects' }],
    location: null,
    foundedDate: '2005-01-01T00:00:00.000Z',
    ...overrides,
  }
}

test('non-test records below the high-quality threshold default to standard', async () => {
  const result = await scoreActivity(sparseRecord())

  assert.equal(result.totalScore, 0)
  assert.equal(result.tier, 'standard')
  assert.deepEqual(result.testSignals, [])
  assert.ok(result.validationNotes.includes('No meaningful profile or organization metadata remains after normalization'))
})

test('high-scoring non-test records are high-quality', async () => {
  const result = await scoreActivity(completeRecord())

  assert.equal(result.tier, 'high-quality')
  assert.deepEqual(result.testSignals, [])
  assert.ok(result.totalScore >= 70)
})

test('hard test signals override score tier without zeroing the score', async () => {
  const result = await scoreActivity(completeRecord({
    displayName: 'Test Org',
    profileDisplayName: 'Test Org',
  }))

  assert.equal(result.tier, 'likely-test')
  assert.ok(result.totalScore >= 70)
  assert.ok(result.testSignals.includes('Display name contains placeholder text'))
})

test('tierForScore only returns likely-test when hard test evidence exists', () => {
  assert.equal(tierForScore(0), 'standard')
  assert.equal(tierForScore(69), 'standard')
  assert.equal(tierForScore(70), 'high-quality')
  assert.equal(tierForScore(90, ['actor-pds-test-host: epds1.test.certified.app']), 'likely-test')
})
