import type { LabelTier, ScoreBreakdown, ScoreResult } from './types'
import type { MergedScoringInput, UrlResolutionMap, UrlResolutionState } from './scoring-input'
import { AUTHENTICITY_FAILURE_TIER, COMPLETENESS_WEIGHTS, FOUNDED_DATE_AGE_BUCKETS, SCORE_THRESHOLDS } from './constants'
import { evaluateMergedActorAuthenticity } from './scoring-authenticity'
import { validateOrganizationLocationRef } from './location-utils'
import { displayNameMatchesWebsiteDomain, normalizePublicWebsiteUrl } from './website-utils'

export type ScoreResultWithValidationNotes = ScoreResult & {
  validationNotes: string[]
}

const ZERO_BREAKDOWN: ScoreBreakdown = {
  displayName: 0,
  description: 0,
  organizationType: 0,
  websitePresent: 0,
  websiteResolves: 0,
  websiteMatchesName: 0,
  organizationUrlsPresent: 0,
  organizationUrlsResolve: 0,
  locationValid: 0,
  foundedDateValid: 0,
  foundedDateAge: 0,
  avatar: 0,
  banner: 0,
}

// Organization records do not currently cap the number of URL refs in the
// generated lexicon. Keep URL scoring bounded and avoid network calls on the Tap
// ack path.
const MAX_ORGANIZATION_URLS_TO_CHECK = 3

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function scoreOrganizationType(organizationType: MergedScoringInput['organizationType']): number {
  const values = (organizationType ?? [])
    .map(normalizeText)
    .filter(value => value.length > 0)

  return values.length > 0 ? COMPLETENESS_WEIGHTS.organizationType : 0
}

function scoreDisplayName(displayNameSource: MergedScoringInput['displayNameSource'], displayName: string): number {
  if (!displayName) return 0
  if (displayNameSource === 'did') return 0

  return COMPLETENESS_WEIGHTS.displayName
}

function scoreDescription(description: string | null): number {
  if (!description) return 0
  return COMPLETENESS_WEIGHTS.description
}

function scoreWebsitePresent(website: string | null): number {
  return website ? COMPLETENESS_WEIGHTS.websitePresent : 0
}

function getUrlResolutionState(normalizedUrl: string, urlResolution?: UrlResolutionMap): UrlResolutionState {
  return urlResolution?.[normalizedUrl] ?? 'unknown'
}

function scoreWebsiteResolves(website: string | null, urlResolution?: UrlResolutionMap): number {
  const normalized = normalizePublicWebsiteUrl(website)
  if (!normalized) return 0

  return getUrlResolutionState(normalized, urlResolution) === 'failed'
    ? 0
    : COMPLETENESS_WEIGHTS.websiteResolves
}

function scoreWebsiteMatchesName(displayName: string, website: string | null): number {
  if (!website) return 0
  return displayNameMatchesWebsiteDomain(displayName, website) ? COMPLETENESS_WEIGHTS.websiteMatchesName : 0
}

function scoreOrganizationUrlsPresent(urls: MergedScoringInput['urls']): number {
  return (urls ?? []).length > 0 ? COMPLETENESS_WEIGHTS.organizationUrlsPresent : 0
}

function scoreOrganizationUrlsResolve(urls: MergedScoringInput['urls'], urlResolution?: UrlResolutionMap): number {
  const normalizedUrls = (Array.isArray(urls) ? urls : [])
    .map(item => normalizePublicWebsiteUrl(item?.url))
    .filter((url): url is string => Boolean(url))
    .slice(0, MAX_ORGANIZATION_URLS_TO_CHECK)

  const hasResolvableUrl = normalizedUrls.some(url => getUrlResolutionState(url, urlResolution) !== 'failed')

  return hasResolvableUrl ? COMPLETENESS_WEIGHTS.organizationUrlsResolve : 0
}

function scoreLocation(location: MergedScoringInput['location']): number {
  return validateOrganizationLocationRef(location).valid ? COMPLETENESS_WEIGHTS.locationValid : 0
}

function scoreFoundedDateValid(value: string | null, now: number): number {
  const normalized = normalizeText(value)
  if (!normalized) return 0

  const timestamp = Date.parse(normalized)
  if (Number.isNaN(timestamp)) return 0
  if (timestamp > now) return 0

  return COMPLETENESS_WEIGHTS.foundedDateValid
}

function scoreFoundedDateAge(value: string | null, now: number): number {
  const normalized = normalizeText(value)
  if (!normalized) return 0

  const timestamp = Date.parse(normalized)
  if (Number.isNaN(timestamp)) return 0
  if (timestamp > now) return 0

  const ageMs = now - timestamp
  const bucket = FOUNDED_DATE_AGE_BUCKETS.oneYearOrOlder

  return ageMs >= bucket.minAgeMs ? bucket.score : 0
}

function scoreAvatar(hasAvatar: boolean): number {
  return hasAvatar ? COMPLETENESS_WEIGHTS.avatar : 0
}

function scoreBanner(hasBanner: boolean): number {
  return hasBanner ? COMPLETENESS_WEIGHTS.banner : 0
}

export async function scoreActivity(record: MergedScoringInput): Promise<ScoreResultWithValidationNotes> {
  const authenticity = evaluateMergedActorAuthenticity(record)
  const validationNotes = record.validationNotes ?? []

  if (!authenticity.passed) {
    return {
      totalScore: 0,
      tier: AUTHENTICITY_FAILURE_TIER,
      breakdown: ZERO_BREAKDOWN,
      testSignals: authenticity.signals,
      validationNotes,
    }
  }

  const websiteResolves = scoreWebsiteResolves(record.profileWebsite, record.urlResolution)
  const organizationUrlsResolve = scoreOrganizationUrlsResolve(record.urls, record.urlResolution)
  const now = Date.now()

  const displayName = scoreDisplayName(record.displayNameSource, record.displayName)
  const description = scoreDescription(record.profileDescription)
  const organizationType = scoreOrganizationType(record.organizationType)
  const websitePresent = scoreWebsitePresent(record.profileWebsite)
  const websiteMatchesName = scoreWebsiteMatchesName(record.displayName, record.profileWebsite)
  const organizationUrlsPresent = scoreOrganizationUrlsPresent(record.urls)
  const locationValid = scoreLocation(record.location)
  const foundedDateValid = scoreFoundedDateValid(record.foundedDate, now)
  const foundedDateAge = scoreFoundedDateAge(record.foundedDate, now)
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

  const rawScore = Object.values(breakdown).reduce((sum, value) => sum + value, 0)
  const totalScore = rawScore
  const tier = tierForScore(totalScore)

  return {
    totalScore,
    tier,
    breakdown,
    testSignals: [],
    validationNotes,
  }
}

export function tierForScore(score: number, testSignals: string[] = []): LabelTier {
  if (testSignals.length > 0) return 'likely-test'
  if (score >= SCORE_THRESHOLDS['high-quality'].min) return 'high-quality'
  if (score >= SCORE_THRESHOLDS.standard.min) return 'standard'
  return 'likely-test'
}

export function labelIdentifierForTier(tier: LabelTier): string {
  return tier
}
