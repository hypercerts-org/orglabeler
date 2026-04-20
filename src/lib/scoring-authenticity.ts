import type { MergedScoringInput } from './scoring-input'
import { AUTHENTICITY_TEXT_PATTERNS } from './constants'
import { normalizePublicWebsiteUrl } from './website-utils'

export interface AuthenticityGateResult {
  passed: boolean
  signals: string[]
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

function hasMeaningfulText(value: unknown): boolean {
  const normalized = normalizeText(value)
  return normalized.length > 0 && !AUTHENTICITY_TEXT_PATTERNS.some(pattern => pattern.test(normalized))
}

function pushSignal(signals: string[], signal: string): void {
  if (!signals.includes(signal)) signals.push(signal)
}

function validateWebsite(value: string | null | undefined, signal: string, signals: string[]): boolean {
  const normalized = normalizeText(value)
  if (!normalized) return false

  if (normalizePublicWebsiteUrl(normalized)) return true

  pushSignal(signals, signal)
  return false
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
  let hasPlaceholderLabel = false

  for (const item of urls ?? []) {
    const url = normalizeText(item.url)
    const label = normalizeText(item.label)

    if (url) {
      if (normalizePublicWebsiteUrl(url)) {
        hasMeaningfulMetadata = true
      } else {
        hasInvalidUrl = true
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

  if (hasPlaceholderLabel) {
    pushSignal(signals, 'Organization URL labels contain placeholder text')
  }

  return { hasMeaningfulMetadata }
}

export function evaluateMergedActorAuthenticity(record: MergedScoringInput): AuthenticityGateResult {
  const signals: string[] = []

  const canonicalDisplayName = normalizeText(record.displayName)
  if (canonicalDisplayName && !hasMeaningfulText(canonicalDisplayName)) {
    pushSignal(signals, 'Display name contains placeholder text')
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
    signals,
  )

  const organizationUrls = validateOrganizationUrls(record.urls, signals)
  const foundedDate = validateFoundedDate(record.foundedDate, signals)

  const displayNameIsMeaningful = record.displayNameSource !== 'did' && hasMeaningfulText(canonicalDisplayName)
  const organizationTypeIsMeaningful = organizationTypeValues.some(hasMeaningfulText)

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
