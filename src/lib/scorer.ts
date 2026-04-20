import type { LabelTier, ScoreBreakdown, ScoreResult } from './types'
import type { MergedScoringInput } from './scoring-input'
import { AUTHENTICITY_FAILURE_TIER, COMPLETENESS_WEIGHTS, SCORE_THRESHOLDS } from './constants'
import { resolvePublicUrl } from './link-resolver'
import { evaluateMergedActorAuthenticity } from './scoring-authenticity'
import { validateOrganizationLocationRef } from './location-utils'
import { displayNameMatchesWebsiteDomain, normalizePublicWebsiteUrl } from './website-utils'

const HIGH_QUALITY_THRESHOLD = SCORE_THRESHOLDS['high-quality'].min
const STANDARD_THRESHOLD = SCORE_THRESHOLDS.standard.min

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

async function scoreWebsiteResolves(website: string | null): Promise<number> {
  const normalized = normalizePublicWebsiteUrl(website)
  if (!normalized) return 0

  const result = await resolvePublicUrl(normalized)
  return result.resolvable ? COMPLETENESS_WEIGHTS.websiteResolves : 0
}

function scoreWebsiteMatchesName(displayName: string, website: string | null): number {
  if (!website) return 0
  return displayNameMatchesWebsiteDomain(displayName, website) ? COMPLETENESS_WEIGHTS.websiteMatchesName : 0
}

function scoreOrganizationUrlsPresent(urls: MergedScoringInput['urls']): number {
  return (urls ?? []).length > 0 ? COMPLETENESS_WEIGHTS.organizationUrlsPresent : 0
}

async function scoreOrganizationUrlsResolve(urls: MergedScoringInput['urls']): Promise<number> {
  for (const item of Array.isArray(urls) ? urls : []) {
    const normalized = normalizePublicWebsiteUrl(item.url)
    if (!normalized) continue

    const result = await resolvePublicUrl(normalized)
    if (result.resolvable) return COMPLETENESS_WEIGHTS.organizationUrlsResolve
  }

  return 0
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
  return ageMs >= 365 * 24 * 60 * 60 * 1000 ? COMPLETENESS_WEIGHTS.foundedDateAge : 0
}

function scoreAvatar(hasAvatar: boolean): number {
  return hasAvatar ? COMPLETENESS_WEIGHTS.avatar : 0
}

function scoreBanner(hasBanner: boolean): number {
  return hasBanner ? COMPLETENESS_WEIGHTS.banner : 0
}

export async function scoreActivity(record: MergedScoringInput): Promise<ScoreResult> {
  const authenticity = evaluateMergedActorAuthenticity(record)
  if (!authenticity.passed) {
    return {
      totalScore: 0,
      tier: AUTHENTICITY_FAILURE_TIER,
      breakdown: ZERO_BREAKDOWN,
      testSignals: authenticity.signals,
    }
  }

  const [websiteResolves, organizationUrlsResolve] = await Promise.all([
    scoreWebsiteResolves(record.profileWebsite),
    scoreOrganizationUrlsResolve(record.urls),
  ])
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

  const totalScore = Math.min(100, Object.values(breakdown).reduce((sum, value) => sum + value, 0))
  const tier = tierForScore(totalScore)

  return {
    totalScore,
    tier,
    breakdown,
    testSignals: [],
  }
}

export function tierForScore(score: number, testSignals: string[] = []): LabelTier {
  if (testSignals.length > 0) return 'likely-test'
  if (score >= HIGH_QUALITY_THRESHOLD) return 'high-quality'
  if (score >= STANDARD_THRESHOLD) return 'standard'
  return 'likely-test'
}

export function labelIdentifierForTier(tier: LabelTier): string {
  return tier
}
