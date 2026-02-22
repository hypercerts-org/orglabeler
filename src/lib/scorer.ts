import type { ActivityRecord, ScoreResult, ScoreBreakdown, LabelTier } from './types'
import { TEST_PATTERNS, SCORE_THRESHOLDS } from './constants'

interface RepetitionResult {
  lineRepeatRatio: number
  wordRepeatRatio: number
  maxLineRepeats: number
}

export function detectRepetition(text: string): RepetitionResult {
  const lines = text.split('\n').filter(l => l.trim().length > 0)
  const words = text.split(/\s+/).filter(w => w.length > 0)

  // lineRepeatRatio: unique lines / total lines
  const uniqueLines = new Set(lines.map(l => l.trim()))
  const lineRepeatRatio = lines.length > 0 ? uniqueLines.size / lines.length : 1

  // wordRepeatRatio: unique words / total words (case-insensitive)
  const uniqueWords = new Set(words.map(w => w.toLowerCase()))
  const wordRepeatRatio = words.length > 0 ? uniqueWords.size / words.length : 1

  // maxLineRepeats: highest count of any single non-empty line
  const lineCounts = new Map<string, number>()
  for (const line of lines) {
    const key = line.trim()
    lineCounts.set(key, (lineCounts.get(key) ?? 0) + 1)
  }
  const maxLineRepeats = lineCounts.size > 0 ? Math.max(...lineCounts.values()) : 0

  return { lineRepeatRatio, wordRepeatRatio, maxLineRepeats }
}

export function scoreActivity(record: ActivityRecord): ScoreResult {
  const testSignals: string[] = []

  // --- Test signal detection (checked BEFORE scoring) ---
  const title = record.title ?? ''
  const shortDesc = record.shortDescription ?? ''
  const desc = record.description ?? ''

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

  // shortDescription identical to description (lazy copy-paste)
  if (
    desc.trim().length > 0 &&
    shortDesc.trim().toLowerCase() === desc.trim().toLowerCase()
  ) {
    testSignals.push('short description identical to description')
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
    } else if (typeof workScope === 'object') {
      if (
        ('uri' in workScope && workScope.uri) ||
        ('cid' in workScope && workScope.cid) ||
        ('labels' in workScope && Array.isArray(workScope.labels) && workScope.labels.length > 0) ||
        ('expression' in workScope && typeof workScope.expression === 'string' && workScope.expression.length > 0)
      ) {
        hasWorkScope = 10
      }
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

  // 10. Repetition detection
  const descRep = detectRepetition(desc)
  const descLines = desc.split('\n').filter(l => l.trim().length > 0)
  const descWords = desc.split(/\s+/).filter(w => w.length > 0)

  if (descRep.lineRepeatRatio < 0.4 && descLines.length > 8) {
    testSignals.push(`description has high line repetition (${descRep.lineRepeatRatio.toFixed(2)})`)
  }
  if (descRep.wordRepeatRatio < 0.25 && descWords.length > 30) {
    testSignals.push(`description has high word repetition (${descRep.wordRepeatRatio.toFixed(2)})`)
  }
  if (descRep.maxLineRepeats >= 4) {
    testSignals.push(`description line repeated ${descRep.maxLineRepeats} times`)
  }

  const shortDescText = record.shortDescription ?? ''
  const shortRep = detectRepetition(shortDescText)
  const shortDescLines = shortDescText.split('\n').filter(l => l.trim().length > 0)
  const shortDescWordList = shortDescText.split(/\s+/).filter(w => w.length > 0)

  if (shortRep.lineRepeatRatio < 0.3 && shortDescLines.length > 8) {
    testSignals.push(`short description has high line repetition (${shortRep.lineRepeatRatio.toFixed(2)})`)
  }
  if (shortRep.wordRepeatRatio < 0.2 && shortDescWordList.length > 30) {
    testSignals.push(`short description has high word repetition (${shortRep.wordRepeatRatio.toFixed(2)})`)
  }
  if (shortRep.maxLineRepeats >= 3) {
    testSignals.push(`short description line repeated ${shortRep.maxLineRepeats} times`)
  }

  // Count repetition signals added above (signals containing 'repetition' or 'repeated')
  const repetitionSignalCount = testSignals.filter(s =>
    s.includes('repetition') || s.includes('repeated')
  ).length
  const repetitionFlags = Math.max(-15, repetitionSignalCount * -5)

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
    repetitionFlags,
  }

  const rawScore =
    titleQuality +
    shortDescQuality +
    descriptionQuality +
    hasImage +
    hasWorkScope +
    contributorQuality +
    hasLocations +
    hasDateRange +
    hasRights

  const totalScore = Math.max(0, rawScore + repetitionFlags)

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
