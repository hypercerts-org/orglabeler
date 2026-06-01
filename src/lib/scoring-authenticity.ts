import type { MergedScoringInput } from './scoring-input'
import {
  AUTHENTICITY_TEXT_PATTERNS,
  DESCRIPTION_AUTHENTICITY_TEXT_PATTERNS,
  DISPLAY_NAME_AUTHENTICITY_TEXT_PATTERNS,
  SHORT_FIELD_AUTHENTICITY_TEXT_PATTERNS,
} from './constants'
import { isPlaceholderWebsiteUrl, normalizePublicWebsiteUrl } from './website-utils'

/** Result of separating hard test evidence from softer data-quality issues. */
export interface AuthenticityGateResult {
  /** True when no hard test evidence was found. Validation notes do not fail the gate. */
  passed: boolean
  /** Hard evidence that should force the likely-test label. */
  testSignals: string[]
  /** Data-quality issues that should be shown to operators without changing the tier. */
  validationNotes: string[]
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

function matchesAnyPattern(value: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(value))
}

function hasMeaningfulText(value: unknown, patterns: RegExp[] = AUTHENTICITY_TEXT_PATTERNS): boolean {
  const normalized = normalizeText(value)
  return normalized.length > 0 && !matchesAnyPattern(normalized, patterns)
}

function hasRepeatedCharacterRun(value: string): boolean {
  return /([\p{Letter}\p{Number}])\1{3,}/iu.test(value)
}

function pushUnique(items: string[], item: string): void {
  if (!items.includes(item)) items.push(item)
}

function validateWebsite(
  value: string | null | undefined,
  invalidUrlNote: string,
  placeholderDomainSignal: string,
  testSignals: string[],
  validationNotes: string[],
): boolean {
  const normalized = normalizeText(value)
  if (!normalized) return false

  if (!normalizePublicWebsiteUrl(normalized)) {
    pushUnique(validationNotes, invalidUrlNote)
    return false
  }

  if (isPlaceholderWebsiteUrl(normalized)) {
    pushUnique(testSignals, placeholderDomainSignal)
    return false
  }

  return true
}

function validateFoundedDate(value: string | null | undefined, validationNotes: string[]): boolean {
  const normalized = normalizeText(value)
  if (!normalized) return false

  const timestamp = Date.parse(normalized)
  if (Number.isNaN(timestamp)) {
    pushUnique(validationNotes, 'foundedDate is invalid')
    return false
  }

  if (timestamp > Date.now()) {
    pushUnique(validationNotes, 'foundedDate cannot be in the future')
    return false
  }

  return true
}

function validateOrganizationUrls(
  urls: MergedScoringInput['urls'],
  testSignals: string[],
  validationNotes: string[],
): { hasMeaningfulMetadata: boolean } {
  let hasMeaningfulMetadata = false
  let hasInvalidUrl = false
  let hasPlaceholderDomain = false
  let hasPlaceholderLabel = false

  for (const item of urls ?? []) {
    const url = normalizeText(item.url)
    const label = normalizeText(item.label)

    if (url) {
      if (!normalizePublicWebsiteUrl(url)) {
        hasInvalidUrl = true
      } else if (isPlaceholderWebsiteUrl(url)) {
        hasPlaceholderDomain = true
      } else {
        hasMeaningfulMetadata = true
      }
    }

    if (label) {
      if (hasMeaningfulText(label, SHORT_FIELD_AUTHENTICITY_TEXT_PATTERNS)) {
        hasMeaningfulMetadata = true
      } else {
        hasPlaceholderLabel = true
      }
    }
  }

  if (hasInvalidUrl) {
    pushUnique(validationNotes, 'Organization URL must be a public http(s) URL')
  }

  if (hasPlaceholderDomain) {
    pushUnique(testSignals, 'Organization URLs use placeholder domains')
  }

  if (hasPlaceholderLabel) {
    pushUnique(validationNotes, 'Organization URL labels contain placeholder text')
  }

  return { hasMeaningfulMetadata }
}

/**
 * Evaluates merged actor metadata before scoring. Hard test evidence is returned
 * as testSignals and should force likely-test. Softer quality problems are
 * returned as validationNotes so they can be displayed without changing tiering.
 */
export function evaluateMergedActorAuthenticity(record: MergedScoringInput): AuthenticityGateResult {
  const testSignals: string[] = []
  const validationNotes: string[] = []

  const canonicalDisplayName = normalizeText(record.displayName)
  const hasProfileDisplayName = record.displayNameSource !== 'did'
  if (hasProfileDisplayName && canonicalDisplayName && !hasMeaningfulText(canonicalDisplayName, DISPLAY_NAME_AUTHENTICITY_TEXT_PATTERNS)) {
    pushUnique(testSignals, 'Display name contains placeholder text')
  }

  if (hasProfileDisplayName && canonicalDisplayName && hasRepeatedCharacterRun(canonicalDisplayName)) {
    pushUnique(testSignals, 'Display name contains repeated characters')
  }

  const profileDescription = normalizeText(record.profileDescription)
  if (profileDescription && !hasMeaningfulText(profileDescription, DESCRIPTION_AUTHENTICITY_TEXT_PATTERNS)) {
    pushUnique(testSignals, 'Profile description contains placeholder text')
  }

  const organizationTypeValues = (record.organizationType ?? []).map(normalizeText).filter(Boolean)
  if (organizationTypeValues.some(value => !hasMeaningfulText(value, SHORT_FIELD_AUTHENTICITY_TEXT_PATTERNS))) {
    pushUnique(validationNotes, 'Organization type contains placeholder text')
  }

  const profileWebsite = validateWebsite(
    record.profileWebsite,
    'Profile website must be a public http(s) URL',
    'Profile website uses placeholder domain',
    testSignals,
    validationNotes,
  )

  const organizationUrls = validateOrganizationUrls(record.urls, testSignals, validationNotes)
  const foundedDate = validateFoundedDate(record.foundedDate, validationNotes)

  const displayNameIsMeaningful = hasProfileDisplayName && hasMeaningfulText(canonicalDisplayName, DISPLAY_NAME_AUTHENTICITY_TEXT_PATTERNS)
  const organizationTypeIsMeaningful = organizationTypeValues.some(value => hasMeaningfulText(value, SHORT_FIELD_AUTHENTICITY_TEXT_PATTERNS))

  const hasMeaningfulMetadata =
    displayNameIsMeaningful ||
    hasMeaningfulText(profileDescription, DESCRIPTION_AUTHENTICITY_TEXT_PATTERNS) ||
    organizationTypeIsMeaningful ||
    profileWebsite ||
    organizationUrls.hasMeaningfulMetadata ||
    foundedDate

  if (!hasMeaningfulMetadata) {
    pushUnique(validationNotes, 'No meaningful profile or organization metadata remains after normalization')

    if (record.displayNameSource === 'did') {
      pushUnique(validationNotes, 'Display name falls back to the DID and no other meaningful fields are present')
    }
  }

  return {
    passed: testSignals.length === 0,
    testSignals,
    validationNotes,
  }
}

/** Backwards-compatible name for evaluating merged actor authenticity. */
export const assessMergedActorAuthenticity = evaluateMergedActorAuthenticity
/** Backwards-compatible name for evaluating merged actor authenticity. */
export const evaluateAuthenticityGate = evaluateMergedActorAuthenticity
