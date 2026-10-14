import type { LabelDefinition } from './types'

export const LABELS: LabelDefinition[] = [
  {
    identifier: 'likely-test',
    locales: [{ lang: 'en', name: '⚠ Likely Test', description: 'Contextual synthetic/test-data signal; not identity or legitimacy verification.' }],
  },
  {
    identifier: 'standard',
    locales: [{ lang: 'en', name: '● Standard', description: 'Standard content-quality assessment; not identity or legitimacy verification.' }],
  },
  {
    identifier: 'high-quality',
    locales: [{ lang: 'en', name: '✦ High Quality', description: 'High content-quality assessment; not identity or legitimacy verification.' }],
  },
]

/** Reserved example domains recognized by placeholder-URL validation. */
export const PLACEHOLDER_DOMAINS = ['example.com', 'example.net', 'example.org'] as const

/** Reserved non-production TLDs recognized by placeholder-URL validation. */
export const PLACEHOLDER_TLDS = ['example', 'invalid', 'test'] as const

export const LABEL_LIMIT = 1
export const QUALITY_LABEL_IDENTIFIERS: string[] = ['likely-test', 'standard', 'high-quality']
