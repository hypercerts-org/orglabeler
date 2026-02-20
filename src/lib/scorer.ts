import type { ActivityRecord, ScoreResult, ScoreBreakdown, LabelTier } from './types'
import { TEST_PATTERNS, SCORE_THRESHOLDS } from './constants'

export function scoreActivity(record: ActivityRecord): ScoreResult {
  const testSignals: string[] = []

  // --- Test signal detection (checked BEFORE scoring) ---
  const title = record.title ?? ''
  const shortDesc = record.shortDescription ?? ''

  // title matches test pattern
  if (TEST_PATTERNS.some(p => p.test(title.trim()))) {
    testSignals.push('title matches test pattern')
  }

  // shortDescription matches test pattern
  if (TEST_PATTERNS.some(p => p.test(shortDesc.trim()))) {
    testSignals.push('short description matches test pattern')
  }

  // title identical to short description (and short)
  if (
    title.trim().toLowerCase() === shortDesc.trim().toLowerCase() &&
    title.length < 50
  ) {
    testSignals.push('title identical to short description')
  }

  // All characters in title are the same (e.g. "aaaa")
  if (title.length > 0 && new Set(title.split('')).size === 1) {
    testSignals.push('title is repeated character')
  }

  // title extremely short
  if (title.length < 3) {
    testSignals.push('title extremely short')
  }

  // Title ends with trailing small number (template spam pattern)
  // e.g. "Clean Energy Community Initiative 37" but NOT short titles like "Phase 2"
  if (/^.{15,}\s+\d{1,3}$/.test(title.trim())) {
    testSignals.push('title ends with trailing number (template spam)')
  }

  // Title first 4 words duplicate shortDescription first 4 words (copy-paste signal)
  const titleWords = title.trim().toLowerCase().split(/\s+/).slice(0, 4).join(' ')
  const shortWords = shortDesc.trim().toLowerCase().split(/\s+/).slice(0, 4).join(' ')
  if (titleWords.length > 10 && titleWords === shortWords) {
    testSignals.push('title duplicates start of short description')
  }

  // --- Scoring ---

  // 1. titleQuality (0-15)
  let titleQuality = 0
  if (TEST_PATTERNS.some(p => p.test(title.trim()))) {
    titleQuality = 0
  } else if (title.length > 30 && title.includes(' ')) {
    titleQuality = 15
  } else if (title.length > 10) {
    titleQuality = 10
  } else if (title.length > 0) {
    titleQuality = 5
  }

  // 2. shortDescQuality (0-15)
  const trimmedShortDesc = shortDesc.trim()
  let shortDescQuality = 0
  if (trimmedShortDesc.length <= 10 || TEST_PATTERNS.some(p => p.test(trimmedShortDesc))) {
    shortDescQuality = 0
  } else if (trimmedShortDesc.length > 150) {
    shortDescQuality = 15
  } else if (trimmedShortDesc.length >= 50) {
    shortDescQuality = 10
  } else {
    // 10 < length <= 50 (already excluded <= 10 above)
    shortDescQuality = 5
  }

  // 3. descriptionQuality (0-20)
  const desc = record.description ?? ''
  let descriptionQuality = 0
  if (!desc || desc.length === 0) {
    descriptionQuality = 0
  } else if (desc.length > 1000) {
    descriptionQuality = 20
  } else if (desc.length >= 500) {
    descriptionQuality = 15
  } else if (desc.length >= 100) {
    descriptionQuality = 10
  } else {
    descriptionQuality = 5
  }

  // 4. hasImage (0-10)
  const image = record.image
  let hasImage = 0
  if (image) {
    if (typeof image === 'string' && image.length > 0) {
      hasImage = 10
    } else if (typeof image === 'object' && (('uri' in image && image.uri) || ('file' in image && image.file))) {
      hasImage = 10
    }
  }

  // 5. hasWorkScope (0-10)
  const workScope = record.workScope
  let hasWorkScope = 0
  if (workScope) {
    if (typeof workScope === 'string' && workScope.length > 0) {
      hasWorkScope = 10
    } else if (typeof workScope === 'object' && (workScope.uri || workScope.cid)) {
      hasWorkScope = 10
    }
  }

  // 6. contributorQuality (0-15)
  const contributors = record.contributors ?? []
  const contributorsWeights = record.contributorsWeights ?? []
  let contributorQuality = 0

  if (contributors.length >= 1) {
    // Check for weights from either source:
    // - Inline: contributor objects with contributionWeight field
    // - Top-level: contributorsWeights number array
    const inlineWeightCount = contributors.filter(c =>
      'contributionWeight' in c && c.contributionWeight != null && c.contributionWeight !== ''
    ).length
    const topLevelWeightCount = contributorsWeights.filter(w => w != null).length
    const hasWeights = Math.max(inlineWeightCount, topLevelWeightCount)

    // Check for details (only available in inline shape)
    const hasDetails = contributors.filter(c =>
      'contributionDetails' in c && c.contributionDetails != null && c.contributionDetails !== ''
    ).length

    if (contributors.length >= 2 && hasWeights >= 2 && hasDetails >= 1) {
      contributorQuality = 15
    } else if (contributors.length >= 2 && hasWeights >= 2) {
      // Reference-style contributors with weights but no inline details
      contributorQuality = 12
    } else if (hasWeights >= 1) {
      contributorQuality = 10
    } else {
      // Contributors listed but no weights
      contributorQuality = 5
    }
  }

  // 7. hasLocations (0-5)
  const locations = record.locations ?? []
  const hasLocations = locations.length >= 1 ? 5 : 0

  // 8. hasDateRange (0-5)
  let hasDateRange = 0
  const hasStart = !!record.startDate
  const hasEnd = !!record.endDate
  if (hasStart && hasEnd) {
    hasDateRange = 5
  } else if (hasStart || hasEnd) {
    hasDateRange = 2
  }

  // 9. hasRights (0-5)
  const hasRights = record.rights ? 5 : 0

  const breakdown: ScoreBreakdown = {
    titleQuality,
    shortDescQuality,
    descriptionQuality,
    hasImage,
    hasWorkScope,
    contributorQuality,
    hasLocations,
    hasDateRange,
    hasRights,
  }

  const totalScore =
    titleQuality +
    shortDescQuality +
    descriptionQuality +
    hasImage +
    hasWorkScope +
    contributorQuality +
    hasLocations +
    hasDateRange +
    hasRights

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
  for (const [tier, { min, max }] of Object.entries(SCORE_THRESHOLDS) as [LabelTier, { min: number; max: number }][]) {
    if (score >= min && score <= max) return tier
  }
  return 'likely-test'
}

export function labelIdentifierForTier(tier: LabelTier): string {
  return tier
}
