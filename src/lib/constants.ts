import type { LabelDefinition } from './types'

type RuntimeQualityTier = 'likely-test' | 'standard' | 'high-quality'

export const AUTHENTICITY_FAILURE_TIER: RuntimeQualityTier = 'likely-test'

// Shared time unit for score boundaries.
export const MS_PER_DAY = 24 * 60 * 60 * 1000

export const LABELS: LabelDefinition[] = [
  {
    identifier: 'likely-test',
    locales: [{ lang: 'en', name: '⚠ Likely Test', description: 'This certified actor organization appears to contain test or placeholder data.' }],
  },
  {
    identifier: 'standard',
    locales: [{ lang: 'en', name: '● Standard', description: 'A certified actor organization with basic profile information in place.' }],
  },
  {
    identifier: 'high-quality',
    locales: [{ lang: 'en', name: '✦ High Quality', description: 'A certified actor organization with complete, well-documented profile details.' }],
  },
]

// Raw completeness weights sum to 100 points.
export const COMPLETENESS_WEIGHTS = {
  displayName: 5,
  description: 10,
  organizationType: 5,
  websitePresent: 10,
  websiteResolves: 15,
  websiteMatchesName: 5,
  organizationUrlsPresent: 5,
  organizationUrlsResolve: 5,
  locationValid: 10,
  foundedDateValid: 5,
  foundedDateAge: 5,
  avatar: 10,
  banner: 10,
} as const

// Final score bands are intentionally coarse. High-quality is open-ended
// because configured bonuses can raise the final score above 100 completeness points.
export const SCORE_THRESHOLDS: Record<RuntimeQualityTier, { min: number; max: number }> = {
  'likely-test': { min: 0, max: 39 },
  standard: { min: 40, max: 69 },
  'high-quality': { min: 70, max: Number.POSITIVE_INFINITY },
}

// Founded-date age scoring is binary: the 5-point bonus applies once the
// organization has existed for at least one year.
export const FOUNDED_DATE_AGE_BUCKETS = {
  oneYearOrOlder: {
    minAgeMs: 365 * MS_PER_DAY,
    score: COMPLETENESS_WEIGHTS.foundedDateAge,
  },
} as const

// Declared raw total for the completeness model before any configured bonuses.
export const COMPLETENESS_WEIGHT_TOTAL = 100

/** Default PDS hosts that receive the trusted-operator score bonus. */
export const DEFAULT_TRUSTED_PDS_HOSTS = ['certified.one', 'gainforest.id'] as const

/** Default score points added when an actor is hosted on a trusted PDS. */
export const DEFAULT_TRUSTED_PDS_BONUS = 10

export const TEST_PATTERNS: RegExp[] = [
  // Word-boundary "test" — catches "Another Test", "Test Contributors", "This is testing", "test 123"
  /\btest(ing|ed|er|s)?\b/i,

  // Common junk prefixes and phrases.
  /^asdf/i, /\blorem ipsum\b/i, /^placeholder/i, /^delete me/i, /^ignore/i, /^zzz/i,

  // Exact match common junk
  /^foo$/i, /^bar$/i, /^abc$/i, /^123$/i, /^wip$/i, /^todo$/i,
  /^untitled$/i, /^sample$/i, /^example$/i,
  /^hello( there)?$/i, /^hi$/i, /^hey$/i,
  /^this is fine$/i, /^no title$/i, /^n\/a$/i, /^none$/i, /^null$/i,
  /^undefined$/i, /^blank$/i, /^draft$/i, /^temp$/i, /^tmp$/i,

  // Repeated characters (aaa, xxx, etc.)
  /^(.)\1{2,}$/,

  // Title is just a number
  /^\d+$/,
]

export const AUTHENTICITY_TEXT_PATTERNS: RegExp[] = [
  ...TEST_PATTERNS,

  // Additional placeholder values commonly used in profile metadata.
  /^unknown$/i,
  /^placeholder$/i,
  /^dummy$/i,
  /^mock$/i,
  /^tbd$/i,
  /^coming soon$/i,
  /^not set$/i,
  /^not specified$/i,
  /^to be determined$/i,
  /^unlisted$/i,
]

/**
 * Extra authenticity patterns for display names, where workflow/test labels are
 * much stronger evidence than the same words appearing in longer descriptions.
 */
export const DISPLAY_NAME_AUTHENTICITY_TEXT_PATTERNS: RegExp[] = [
  ...AUTHENTICITY_TEXT_PATTERNS,
  /(?:^|[^\p{Letter}\p{Number}])(?:demo|dev|staging|qa|e2e|sandbox|fixture)(?:$|[^\p{Letter}\p{Number}])/iu,
  /^tobytest\d*$/i,
  /^exclusivecgstester\d*$/i,
  /\b(?:seed data|new db|changes requested)\b/i,
  /^unpublished(?:\s+org(?:anization)?)?$/i,
  /^published(?:\s+org(?:anization)?)?$/i,
  /^org(?:anization)?(?:[\s._-]*\d+)?$/i,
  /^(?:my\s+)?first\s+org(?:anization)?$/i,
  /^new[\s._-]+org(?:anization)?$/i,
]

/** Reserved example domains that should never count as organization evidence. */
export const PLACEHOLDER_DOMAINS = ['example.com', 'example.net', 'example.org'] as const

/** Reserved non-production TLDs that should fail the authenticity gate. */
export const PLACEHOLDER_TLDS = ['example', 'invalid', 'test'] as const

export const LABEL_LIMIT = 1
export const QUALITY_LABEL_IDENTIFIERS: string[] = ['likely-test', 'standard', 'high-quality']
