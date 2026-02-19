import type { LabelDefinition, LabelTier } from './types'

export const LABELS: LabelDefinition[] = [
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
  'high-quality': { min: 70, max: 100 },
  'standard': { min: 40, max: 69 },
  'draft': { min: 15, max: 39 },
  'likely-test': { min: 0, max: 14 },
}

export const TEST_PATTERNS: RegExp[] = [
  /^test$/i, /^testing$/i, /^asdf/i, /^hello$/i, /^foo$/i, /^bar$/i,
  /^lorem ipsum/i, /^untitled$/i, /^sample$/i, /^example$/i,
  /^aaa+$/i, /^xxx+$/i, /^placeholder/i, /^todo$/i, /^wip$/i,
  /^delete me/i, /^ignore/i, /^abc$/i, /^123$/i, /^zzz/i,
]

export const LABEL_LIMIT = 1
export const QUALITY_LABEL_IDENTIFIERS = ['high-quality', 'standard', 'draft', 'likely-test']
