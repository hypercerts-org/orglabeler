import type { LabelDefinition, LabelTier } from './types'

export const LABELS: LabelDefinition[] = [
  {
    identifier: 'pending',
    locales: [{ lang: 'en', name: '⟳ Pending', description: 'Record detected, evaluation in progress.' }],
  },
  {
    identifier: 'high-quality',
    locales: [{ lang: 'en', name: '✦ High Quality', description: 'Well-documented hypercert with comprehensive activity details.' }],
  },
  {
    identifier: 'standard',
    locales: [{ lang: 'en', name: '● Standard', description: 'Adequate hypercert with basic activity information filled in.' }],
  },
  {
    identifier: 'draft',
    locales: [{ lang: 'en', name: '◌ Draft', description: 'Minimal hypercert — appears to be a work in progress.' }],
  },
  {
    identifier: 'likely-test',
    locales: [{ lang: 'en', name: '⚠ Likely Test', description: 'This hypercert appears to contain test or placeholder data.' }],
  },
]

export const SCORE_THRESHOLDS: Record<LabelTier, { min: number; max: number }> = {
  'pending':      { min: -1, max: -1 },
  'high-quality': { min: 75, max: 100 },
  'standard':     { min: 50, max: 74 },
  'draft':        { min: 20, max: 49 },
  'likely-test':  { min: 0, max: 19 },
}

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

export const LABEL_LIMIT = 1
export const QUALITY_LABEL_IDENTIFIERS = ['pending', 'high-quality', 'standard', 'draft', 'likely-test']
