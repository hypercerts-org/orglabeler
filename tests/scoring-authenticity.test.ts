import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evaluateMergedActorAuthenticity } from '../src/lib/scoring-authenticity'
import type { MergedScoringInput } from '../src/lib/scoring-input'

function record(overrides: Partial<MergedScoringInput> = {}): MergedScoringInput {
  return {
    did: 'did:plc:exampleauthenticity',
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
    location: null,
    foundedDate: null,
    ...overrides,
  }
}

test('display-name workflow and test terms fail the authenticity gate', () => {
  const names = [
    'HC Community Demo',
    'Ma Earth (Dev)',
    'Ma Earth Staging',
    'Alpha QA Org',
    'Staging E2E Org mn8y027w',
    'Sandbox Org',
    'Fixture Org',
    'tobytest',
    'exclusivecgstester1',
    'Seed Data Org',
    'Org demo new DB',
    'Published',
    'Unpublished org',
    'CHANGES REQUESTED ORG',
    'ORG',
    'ORG 1',
    'First org',
    'New Org',
  ]

  for (const displayName of names) {
    const result = evaluateMergedActorAuthenticity(record({ displayName, profileDisplayName: displayName }))
    assert.equal(result.passed, false, displayName)
    assert.ok(result.signals.includes('Display name contains placeholder text'), displayName)
  }
})

test('display-name workflow checks do not punish longer descriptive words or non-display fields', () => {
  const result = evaluateMergedActorAuthenticity(record({
    displayName: 'Community Development Alliance',
    profileDisplayName: 'Community Development Alliance',
    profileDescription: 'We support development teams with demo plots, staging areas, QA review, and E2E checks for local cooperatives.',
  }))

  assert.equal(result.passed, true)
  assert.deepEqual(result.signals, [])
})

test('display-name embedded-test checks do not punish normal words', () => {
  const names = [
    'Contest Foundation',
    'Protest Relief Network',
    'Latest Research Cooperative',
    'Attest Community Trust',
    'Detest River Cleanup',
  ]

  for (const displayName of names) {
    const result = evaluateMergedActorAuthenticity(record({ displayName, profileDisplayName: displayName }))
    assert.equal(result.passed, true, displayName)
    assert.deepEqual(result.signals, [], displayName)
  }
})

test('placeholder profile website domains fail authenticity checks', () => {
  const urls = [
    'https://example.com/about',
    'https://example.net/about',
    'https://example.org/about',
    'https://registry.example/actor',
    'https://registry.invalid/actor',
    'https://registry.test/actor',
  ]

  for (const profileWebsite of urls) {
    const result = evaluateMergedActorAuthenticity(record({ profileWebsite }))
    assert.equal(result.passed, false, profileWebsite)
    assert.ok(result.signals.includes('Profile website uses placeholder domain'), profileWebsite)
  }
})

test('placeholder organization URL domains fail authenticity checks', () => {
  const urls = [
    'https://docs.example.com/project',
    'https://docs.example.net/project',
    'https://docs.example.org/project',
    'https://registry.example/actor',
    'https://registry.invalid/actor',
    'https://registry.test/actor',
  ]

  for (const url of urls) {
    const result = evaluateMergedActorAuthenticity(record({
      urls: [{ url, label: 'Project docs' }],
    }))
    assert.equal(result.passed, false, url)
    assert.ok(result.signals.includes('Organization URLs use placeholder domains'), url)
  }
})

test('DID fallback display names are not checked as user-provided display names', () => {
  const result = evaluateMergedActorAuthenticity(record({
    displayName: 'aaaa12345678…',
    displayNameSource: 'did',
    profileDisplayName: null,
  }))

  assert.equal(result.passed, true)
  assert.deepEqual(result.signals, [])
})

test('display-name repeated character runs fail authenticity checks', () => {
  const result = evaluateMergedActorAuthenticity(record({
    displayName: 'DripsOrrrrr',
    profileDisplayName: 'DripsOrrrrr',
  }))

  assert.equal(result.passed, false)
  assert.ok(result.signals.includes('Display name contains repeated characters'))
})

test('lorem ipsum anywhere in a description fails authenticity checks', () => {
  const result = evaluateMergedActorAuthenticity(record({
    profileDescription: 'What is Lorem Ipsum? Lorem Ipsum is simply dummy text.',
  }))

  assert.equal(result.passed, false)
  assert.ok(result.signals.includes('Profile description contains placeholder text'))
})
