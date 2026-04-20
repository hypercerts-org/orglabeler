import type { LabelDefinition } from './types'

type RuntimeQualityTier = 'likely-test' | 'standard' | 'high-quality'

export const AUTHENTICITY_FAILURE_TIER: RuntimeQualityTier = 'likely-test'

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

export const SCORE_THRESHOLDS: Record<RuntimeQualityTier, { min: number; max: number }> = {
  'likely-test': { min: 0, max: 34 },
  standard: { min: 35, max: 74 },
  'high-quality': { min: 75, max: 100 },
}

export const COMPLETENESS_WEIGHTS = {
  displayName: 15,
  description: 15,
  organizationType: 10,
  websitePresent: 10,
  websiteResolves: 10,
  websiteMatchesName: 5,
  organizationUrlsPresent: 5,
  organizationUrlsResolve: 5,
  locationValid: 5,
  foundedDateValid: 5,
  foundedDateAge: 5,
  avatar: 5,
  banner: 5,
} as const

export const COMPLETENESS_WEIGHT_TOTAL = 100

export const TEST_PATTERNS: RegExp[] = [
  // Word-boundary "test" — catches "Another Test", "Test Contributors", "This is testing", "test 123"
  /\btest(ing|ed|er|s)?\b/i,

  // Common junk prefixes
  /^asdf/i, /^lorem ipsum/i, /^placeholder/i, /^delete me/i, /^ignore/i, /^zzz/i,

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
  /^sample$/i,
  /^tbd$/i,
  /^coming soon$/i,
  /^not set$/i,
  /^not specified$/i,
  /^to be determined$/i,
  /^unlisted$/i,
]

export const LABEL_LIMIT = 1
export const QUALITY_LABEL_IDENTIFIERS: string[] = ['likely-test', 'standard', 'high-quality']
