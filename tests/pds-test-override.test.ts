import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyPdsTestOverride, updatePdsTestSignals } from '../src/lib/pds-test-override'
import type { ScoreResult } from '../src/lib/types'

function scoreResult(): ScoreResult {
  return {
    totalScore: 90,
    tier: 'high-quality',
    breakdown: {
      displayName: 20,
      description: 15,
      organizationType: 10,
      websitePresent: 10,
      websiteResolves: 10,
      websiteMatchesName: 5,
      organizationUrlsPresent: 5,
      organizationUrlsResolve: 5,
      locationValid: 0,
      foundedDateValid: 5,
      foundedDateAge: 0,
      avatar: 5,
      banner: 0,
      trustedPds: 0,
    },
    testSignals: [],
  }
}

test('configured actor PDS host forces likely-test without changing score', () => {
  const result = applyPdsTestOverride(
    scoreResult(),
    'https://EPDS1.test.certified.app/',
    ['epds1.test.certified.app'],
  )

  assert.equal(result.totalScore, 90)
  assert.equal(result.tier, 'likely-test')
  assert.deepEqual(result.testSignals, ['actor-pds-test-host: epds1.test.certified.app'])
})

test('stale actor PDS signals are removed when host is no longer configured', () => {
  const result = updatePdsTestSignals(
    ['actor-pds-test-host: epds1.test.certified.app', 'Display name contains placeholder text'],
    'bsky.social',
    ['epds1.test.certified.app'],
  )

  assert.deepEqual(result, ['Display name contains placeholder text'])
})
