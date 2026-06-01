import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MergedScoringInput } from '../src/lib/scoring-input'

const { scoreActivity, scoreTrustedPdsBonus } = await import('../src/lib/scorer')

function record(overrides: Partial<MergedScoringInput> = {}): MergedScoringInput {
  return {
    did: 'did:plc:trustedpdsactor',
    displayName: 'Forest Recovery Collective',
    displayNameSource: 'profile',
    profileDisplayName: 'Forest Recovery Collective',
    profileDescription: 'A community organization restoring native forest habitats.',
    profileWebsite: null,
    validationNotes: [],
    hasAvatar: true,
    hasBanner: false,
    organizationType: ['nonprofit'],
    urls: [{ url: 'https://forest-recovery.example.coop', label: 'Website' }],
    trustedPdsHosts: ['certified.one', 'gainforest.id'],
    trustedPdsBonus: 10,
    location: null,
    foundedDate: null,
    ...overrides,
  }
}

test('trusted actor PDS hosts receive the configured score bonus', async () => {
  const baseline = await scoreActivity(record({ actorPdsHost: 'bsky.social' }))
  const trusted = await scoreActivity(record({ actorPdsHost: 'https://CERTIFIED.ONE/' }))

  assert.equal(trusted.breakdown.trustedPds, 10)
  assert.equal(trusted.totalScore, baseline.totalScore + 10)
})

test('trusted PDS bonus checks actor PDS host rather than website domain', async () => {
  const result = await scoreActivity(record({
    actorPdsHost: null,
    profileWebsite: 'https://certified.one',
  }))

  assert.equal(result.breakdown.trustedPds, 0)
})

test('trusted PDS host matching is exact after normalization', () => {
  assert.equal(scoreTrustedPdsBonus('https://GAINforest.ID/', ['certified.one', 'gainforest.id'], 10), 10)
  assert.equal(scoreTrustedPdsBonus('not-gainforest.id', ['certified.one', 'gainforest.id'], 10), 0)
  assert.equal(scoreTrustedPdsBonus('gainforest.id.evil.example', ['certified.one', 'gainforest.id'], 10), 0)
})
