import type { ActivityRecord, ScoreBreakdown, ScoreResult, LabelTier } from './types'
import { TEST_PATTERNS } from './constants'

type UrlItem = {
  url?: string
  label?: string
}

const HIGH_QUALITY_THRESHOLD = 75
const STANDARD_THRESHOLD = 35

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isTestString(value: string): boolean {
  return TEST_PATTERNS.some(pattern => pattern.test(value))
}

function scoreOrganizationType(
  organizationType: ActivityRecord['organizationType'],
  testSignals: string[],
): number {
  const values = (organizationType ?? [])
    .map(normalizeText)
    .filter(value => value.length > 0)

  if (values.length === 0) return 0

  if (values.some(isTestString)) {
    testSignals.push('organizationType contains test data')
    return 0
  }

  const uniqueCount = new Set(values.map(value => value.toLowerCase())).size

  if (uniqueCount >= 3) return 30
  if (uniqueCount === 2) return 20
  return 12
}

function scoreUrls(urls: UrlItem[] | undefined, testSignals: string[]): number {
  const items = Array.isArray(urls) ? urls : []
  if (items.length === 0) return 0

  const seenUrls = new Set<string>()
  const seenLabels = new Set<string>()
  let validUrls = 0

  for (const item of items) {
    const url = normalizeText(item?.url)
    const label = normalizeText(item?.label)

    if (!url) continue

    const normalizedUrl = url.toLowerCase()
    if (seenUrls.has(normalizedUrl)) {
      testSignals.push('organization urls repeat the same address')
      continue
    }
    seenUrls.add(normalizedUrl)

    if (isTestString(url) || /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(url)) {
      testSignals.push('organization urls contain test or local addresses')
      continue
    }

    validUrls += 1

    if (label.length > 0) {
      const normalizedLabel = label.toLowerCase()
      if (isTestString(label)) {
        testSignals.push('organization url labels contain test data')
      }
      if (seenLabels.has(normalizedLabel)) {
        testSignals.push('organization url labels repeat')
      }
      seenLabels.add(normalizedLabel)
    }
  }

  if (validUrls === 0) {
    testSignals.push('organization urls are empty or junk')
    return 0
  }

  if (validUrls >= 3) return 30
  if (validUrls === 2) return 20
  return 12
}

function scoreLocation(location: ActivityRecord['location']): number {
  return location ? 20 : 0
}

function scoreDate(
  value: string | undefined,
  label: string,
  points: number,
  testSignals: string[],
): number {
  const normalized = normalizeText(value)
  if (!normalized) return 0

  const timestamp = Date.parse(normalized)
  if (Number.isNaN(timestamp)) {
    testSignals.push(`${label} is invalid`)
    return 0
  }

  if (timestamp > Date.now() + 24 * 60 * 60 * 1000) {
    testSignals.push(`${label} is in the future`)
    return 0
  }

  return points
}

export function scoreActivity(record: ActivityRecord): ScoreResult {
  const testSignals: string[] = []

  const organizationType = scoreOrganizationType(record.organizationType, testSignals)
  const urls = scoreUrls(record.urls as UrlItem[] | undefined, testSignals)
  const location = scoreLocation(record.location)
  const foundedDate = scoreDate(record.foundedDate, 'foundedDate', 15, testSignals)
  const createdAt = scoreDate(record.createdAt, 'createdAt', 15, testSignals)

  if (organizationType === 0 && urls === 0 && location === 0 && foundedDate === 0) {
    testSignals.push('organization metadata is minimal')
  }

  const breakdown: ScoreBreakdown = {
    organizationType,
    urls,
    location,
    foundedDate,
    createdAt,
    titleQuality: Math.min(15, organizationType),
    shortDescQuality: Math.min(15, urls),
    descriptionQuality: Math.min(20, foundedDate),
    hasImage: Math.min(10, location),
    hasWorkScope: Math.min(10, createdAt),
    contributorQuality: organizationType > 0 && urls > 0 ? 10 : 0,
    hasLocations: Math.min(5, location),
    hasDateRange: foundedDate > 0 ? 5 : 0,
    hasRights: createdAt > 0 ? 5 : 0,
    repetitionFlags: 0,
  }

  const totalScore = Math.min(100, Math.max(0, organizationType + urls + location + foundedDate + createdAt))
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
