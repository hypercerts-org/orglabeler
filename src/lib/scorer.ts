import type { LabelTier, ScoreBreakdown, ScoreResult } from './types'
import type { MergedScoringInput } from './scoring-input'
import { COMPLETENESS_WEIGHTS, TEST_PATTERNS } from './constants'
import { validateOrganizationLocationRef } from './location-utils'
import { displayNameMatchesWebsiteDomain, normalizePublicWebsiteUrl } from './website-utils'

const HIGH_QUALITY_THRESHOLD = 75
const STANDARD_THRESHOLD = 35

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isTestString(value: string): boolean {
  return TEST_PATTERNS.some(pattern => pattern.test(value))
}

function isLocalUrl(value: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(value)
}

function scoreOrganizationType(organizationType: MergedScoringInput['organizationType'], testSignals: string[]): number {
  const values = (organizationType ?? [])
    .map(normalizeText)
    .filter(value => value.length > 0)

  if (values.length === 0) return 0

  if (values.some(isTestString)) {
    testSignals.push('organizationType contains test data')
    return 0
  }

  const normalized = new Set(values.map(value => value.toLowerCase()))
  if (normalized.has('other') && normalized.size === 1) return 5
  if (values.length > 0) return COMPLETENESS_WEIGHTS.organizationType
  return 0
}

function scoreDisplayName(displayNameSource: MergedScoringInput['displayNameSource'], displayName: string, testSignals: string[]): number {
  if (!displayName || isTestString(displayName)) {
    if (displayName && isTestString(displayName)) testSignals.push('displayName contains test data')
    return 0
  }

  if (displayNameSource === 'did') return 0

  return COMPLETENESS_WEIGHTS.displayName
}

function scoreDescription(description: string | null, testSignals: string[]): number {
  if (!description) return 0
  if (isTestString(description)) {
    testSignals.push('profile description contains test data')
    return 0
  }

  return COMPLETENESS_WEIGHTS.description
}

function scoreWebsitePresent(website: string | null): number {
  return website ? COMPLETENESS_WEIGHTS.websitePresent : 0
}

function scoreWebsiteResolves(website: string | null, testSignals: string[]): number {
  const normalized = normalizePublicWebsiteUrl(website)
  if (!website) return 0
  if (!normalized) {
    if (isTestString(website) || isLocalUrl(website)) testSignals.push('profile website contains test or local data')
    return 0
  }

  return COMPLETENESS_WEIGHTS.websiteResolves
}

function scoreWebsiteMatchesName(displayName: string, website: string | null): number {
  if (!website) return 0
  return displayNameMatchesWebsiteDomain(displayName, website) ? COMPLETENESS_WEIGHTS.websiteMatchesName : 0
}

function scoreOrganizationUrlsPresent(urls: MergedScoringInput['urls']): number {
  return (urls ?? []).length > 0 ? COMPLETENESS_WEIGHTS.organizationUrlsPresent : 0
}

function scoreOrganizationUrlsResolve(urls: MergedScoringInput['urls'], testSignals: string[]): number {
  const items = Array.isArray(urls) ? urls : []
  const resolved = items.some(item => {
    const normalized = normalizePublicWebsiteUrl(item.url)
    if (!normalized && item.url && (isTestString(item.url) || isLocalUrl(item.url))) {
      testSignals.push('organization urls contain test or local data')
    }
    return Boolean(normalized)
  })

  return resolved ? COMPLETENESS_WEIGHTS.organizationUrlsResolve : 0
}

function scoreLocation(location: MergedScoringInput['location']): number {
  return validateOrganizationLocationRef(location).valid ? COMPLETENESS_WEIGHTS.locationValid : 0
}

function scoreFoundedDateValid(value: string | null, testSignals: string[]): number {
  const normalized = normalizeText(value)
  if (!normalized) return 0

  const timestamp = Date.parse(normalized)
  if (Number.isNaN(timestamp)) {
    testSignals.push('foundedDate is invalid')
    return 0
  }

  if (timestamp > Date.now() + 24 * 60 * 60 * 1000) {
    testSignals.push('foundedDate is in the future')
    return 0
  }

  return COMPLETENESS_WEIGHTS.foundedDateValid
}

function scoreFoundedDateAge(value: string | null): number {
  const normalized = normalizeText(value)
  if (!normalized) return 0

  const timestamp = Date.parse(normalized)
  if (Number.isNaN(timestamp)) return 0
  if (timestamp > Date.now() + 24 * 60 * 60 * 1000) return 0

  const ageMs = Date.now() - timestamp
  return ageMs >= 365 * 24 * 60 * 60 * 1000 ? COMPLETENESS_WEIGHTS.foundedDateAge : 0
}

function scoreAvatar(hasAvatar: boolean): number {
  return hasAvatar ? COMPLETENESS_WEIGHTS.avatar : 0
}

function scoreBanner(hasBanner: boolean): number {
  return hasBanner ? COMPLETENESS_WEIGHTS.banner : 0
}

export function scoreActivity(record: MergedScoringInput): ScoreResult {
  const testSignals: string[] = []

  const displayName = scoreDisplayName(record.displayNameSource, record.displayName, testSignals)
  const description = scoreDescription(record.profileDescription, testSignals)
  const organizationType = scoreOrganizationType(record.organizationType, testSignals)
  const websitePresent = scoreWebsitePresent(record.profileWebsite)
  const websiteResolves = scoreWebsiteResolves(record.profileWebsite, testSignals)
  const websiteMatchesName = scoreWebsiteMatchesName(record.displayName, record.profileWebsite)
  const organizationUrlsPresent = scoreOrganizationUrlsPresent(record.urls)
  const organizationUrlsResolve = scoreOrganizationUrlsResolve(record.urls, testSignals)
  const locationValid = scoreLocation(record.location)
  const foundedDateValid = scoreFoundedDateValid(record.foundedDate, testSignals)
  const foundedDateAge = scoreFoundedDateAge(record.foundedDate)
  const avatar = scoreAvatar(record.hasAvatar)
  const banner = scoreBanner(record.hasBanner)

  const breakdown: ScoreBreakdown = {
    displayName,
    description,
    organizationType,
    websitePresent,
    websiteResolves,
    websiteMatchesName,
    organizationUrlsPresent,
    organizationUrlsResolve,
    locationValid,
    foundedDateValid,
    foundedDateAge,
    avatar,
    banner,
  }

  const totalScore = Math.min(100, Object.values(breakdown).reduce((sum, value) => sum + value, 0))
  const tier = tierForScore(totalScore, testSignals)

  return {
    totalScore,
    tier,
    breakdown,
    testSignals,
  }
}

export function tierForScore(score: number, testSignals: string[]): LabelTier {
  if (testSignals.length > 0) return 'likely-test'
  if (score >= HIGH_QUALITY_THRESHOLD) return 'high-quality'
  if (score >= STANDARD_THRESHOLD) return 'standard'
  return 'likely-test'
}

export function labelIdentifierForTier(tier: LabelTier): string {
  return tier
}
