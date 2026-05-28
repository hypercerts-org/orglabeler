import type { MergedScoringInput } from './scoring-input'
import { AUTHENTICITY_TEXT_PATTERNS, DISPLAY_NAME_AUTHENTICITY_TEXT_PATTERNS } from './constants'
import { isPlaceholderWebsiteUrl, normalizePublicWebsiteUrl } from './website-utils'

export interface AuthenticityGateResult {
  passed: boolean
  signals: string[]
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

function hasMeaningfulText(value: unknown, patterns: RegExp[] = AUTHENTICITY_TEXT_PATTERNS): boolean {
  const normalized = normalizeText(value)
  return normalized.length > 0 && !patterns.some(pattern => pattern.test(normalized))
}

function hasRepeatedCharacterRun(value: string): boolean {
  return /([\p{Letter}\p{Number}])\1{3,}/iu.test(value)
}

function pushSignal(signals: string[], signal: string): void {
  if (!signals.includes(signal)) signals.push(signal)
}

function validateWebsite(
  value: string | null | undefined,
  invalidUrlSignal: string,
  placeholderDomainSignal: string,
  signals: string[],
): boolean {
  const normalized = normalizeText(value)
  if (!normalized) return false

  if (!normalizePublicWebsiteUrl(normalized)) {
    pushSignal(signals, invalidUrlSignal)
    return false
  }

  if (isPlaceholderWebsiteUrl(normalized)) {
    pushSignal(signals, placeholderDomainSignal)
    return false
  }

  return true
}

function validateFoundedDate(value: string | null | undefined, signals: string[]): boolean {
  const normalized = normalizeText(value)
  if (!normalized) return false

  const timestamp = Date.parse(normalized)
  if (Number.isNaN(timestamp)) {
    pushSignal(signals, 'foundedDate is invalid')
    return false
  }

  if (timestamp > Date.now()) {
    pushSignal(signals, 'foundedDate cannot be in the future')
    return false
  }

  return true
}

function validateOrganizationUrls(
  urls: MergedScoringInput['urls'],
  signals: string[],
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
      if (hasMeaningfulText(label)) {
        hasMeaningfulMetadata = true
      } else {
        hasPlaceholderLabel = true
      }
    }
  }

  if (hasInvalidUrl) {
    pushSignal(signals, 'Organization URL must be a public http(s) URL')
  }

  if (hasPlaceholderDomain) {
    pushSignal(signals, 'Organization URLs use placeholder domains')
  }

  if (hasPlaceholderLabel) {
    pushSignal(signals, 'Organization URL labels contain placeholder text')
  }

  return { hasMeaningfulMetadata }
}

export function evaluateMergedActorAuthenticity(record: MergedScoringInput): AuthenticityGateResult {
  const signals: string[] = []

  const canonicalDisplayName = normalizeText(record.displayName)
  const hasProfileDisplayName = record.displayNameSource !== 'did'
  if (hasProfileDisplayName && canonicalDisplayName && !hasMeaningfulText(canonicalDisplayName, DISPLAY_NAME_AUTHENTICITY_TEXT_PATTERNS)) {
    pushSignal(signals, 'Display name contains placeholder text')
  }

  if (hasProfileDisplayName && canonicalDisplayName && hasRepeatedCharacterRun(canonicalDisplayName)) {
    pushSignal(signals, 'Display name contains repeated characters')
  }

  const profileDescription = normalizeText(record.profileDescription)
  if (profileDescription && !hasMeaningfulText(profileDescription)) {
    pushSignal(signals, 'Profile description contains placeholder text')
  }

  const organizationTypeValues = (record.organizationType ?? []).map(normalizeText).filter(Boolean)
  if (organizationTypeValues.some(value => !hasMeaningfulText(value))) {
    pushSignal(signals, 'Organization type contains placeholder text')
  }

  const profileWebsite = validateWebsite(
    record.profileWebsite,
    'Profile website must be a public http(s) URL',
    'Profile website uses placeholder domain',
    signals,
  )

  const organizationUrls = validateOrganizationUrls(record.urls, signals)
  const foundedDate = validateFoundedDate(record.foundedDate, signals)

  const displayNameIsMeaningful = hasProfileDisplayName && hasMeaningfulText(canonicalDisplayName, DISPLAY_NAME_AUTHENTICITY_TEXT_PATTERNS)
  const organizationTypeIsMeaningful = organizationTypeValues.some(value => hasMeaningfulText(value))

  const hasMeaningfulMetadata =
    displayNameIsMeaningful ||
    hasMeaningfulText(profileDescription) ||
    organizationTypeIsMeaningful ||
    profileWebsite ||
    organizationUrls.hasMeaningfulMetadata ||
    foundedDate

  if (!hasMeaningfulMetadata) {
    pushSignal(signals, 'No meaningful profile or organization metadata remains after normalization')

    if (record.displayNameSource === 'did') {
      pushSignal(signals, 'Display name falls back to the DID and no other meaningful fields are present')
    }
  }

  return {
    passed: signals.length === 0,
    signals,
  }
}

export const assessMergedActorAuthenticity = evaluateMergedActorAuthenticity
export const evaluateAuthenticityGate = evaluateMergedActorAuthenticity
