import { isIP } from 'node:net'
import { PLACEHOLDER_DOMAINS, PLACEHOLDER_TLDS } from './constants'

const COMMON_2ND_LEVEL_SUFFIXES = new Set([
  'ac',
  'co',
  'com',
  'edu',
  'gov',
  'info',
  'mil',
  'net',
  'ne',
  'org',
  'or',
])

const NON_TOKEN_RE = /[^\p{Letter}\p{Number}]+/gu
const DIACRITICS_RE = /[\u0300-\u036f]/g

function stripDiacritics(value: string): string {
  return value.normalize('NFKD').replace(DIACRITICS_RE, '')
}

function normalizeTextTokens(value: string): string[] {
  const normalized = stripDiacritics(value)
    .toLowerCase()
    .replace(NON_TOKEN_RE, ' ')
    .trim()

  if (!normalized) return []

  return normalized.split(/\s+/).filter(Boolean)
}

function compactText(value: string): string {
  return normalizeTextTokens(value).join('')
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, '')
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(part => Number(part))
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }

  const [a, b] = parts

  // Obvious local/private ranges only: this helper avoids live DNS lookups, so
  // it intentionally focuses on addresses that can be recognized from syntax.
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && parts[2] === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && parts[2] === 100) ||
    (a === 203 && b === 0 && parts[2] === 113) ||
    a >= 224
  )
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase()

  // Same idea as IPv4: reject addresses that are clearly local, private, or
  // otherwise non-public without needing to resolve the host.
  return (
    normalized === '::' ||
    normalized === '::1' ||
    (normalized.startsWith('::ffff:') && isPrivateIpv4(normalized.slice(7))) ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('ff')
  )
}

/** Returns true when a literal IP address is globally routable enough for URL enrichment fetches. */
export function isPublicNetworkAddress(address: string): boolean {
  const normalized = address.replace(/^\[(.*)\]$/, '$1').toLowerCase()
  const ipVersion = isIP(normalized)

  if (ipVersion === 4) return !isPrivateIpv4(normalized)
  if (ipVersion === 6) return !isPrivateIpv6(normalized)

  return false
}

function isPublicHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname)

  if (!normalized || normalized === 'localhost' || normalized.endsWith('.localhost')) {
    return false
  }

  const ipVersion = isIP(normalized)
  if (ipVersion === 4 || ipVersion === 6) return isPublicNetworkAddress(normalized)

  if (normalized.startsWith('.') || normalized.endsWith('.') || normalized.includes('..')) return false
  if (/^[0-9.]+$/.test(normalized)) return false

  return normalized.split('.').every(label =>
    label.length > 0 &&
    label.length <= 63 &&
    /^[a-z0-9-]+$/.test(label) &&
    !label.startsWith('-') &&
    !label.endsWith('-'),
  )
}

function normalizeDomainLabel(label: string): string {
  return stripDiacritics(label).toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, '')
}

function getDomainStemFromHostname(hostname: string): string | null {
  const normalized = normalizeHostname(hostname)
  const labels = normalized.split('.').filter(Boolean)

  if (labels.length < 2) return null

  const last = labels.at(-1)
  const secondLast = labels.at(-2)
  const thirdLast = labels.at(-3)

  if (!last || !secondLast) return null

  // Heuristic for common ccTLD patterns such as `example.co.uk` or
  // `example.com.au`: treat the label before the 2-part public suffix as the
  // canonical brand stem. This keeps matching deterministic without bundling a
  // public-suffix database.
  const stem = last.length === 2 && COMMON_2ND_LEVEL_SUFFIXES.has(secondLast) && thirdLast
    ? thirdLast
    : secondLast

  return normalizeDomainLabel(stem) || null
}

export function normalizePublicWebsiteUrl(value: string | null | undefined): string | null {
  const raw = value?.trim()
  if (!raw) return null

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (parsed.username || parsed.password) return null

  const hostname = normalizeHostname(parsed.hostname)
  if (!isPublicHostname(hostname)) return null

  parsed.hostname = hostname
  if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) {
    parsed.port = ''
  }

  return parsed.toString()
}

function isPlaceholderHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname)
  const labels = normalized.split('.').filter(Boolean)
  const tld = labels.at(-1)

  if (PLACEHOLDER_DOMAINS.some(domain => normalized === domain || normalized.endsWith(`.${domain}`))) {
    return true
  }

  return Boolean(tld && PLACEHOLDER_TLDS.includes(tld as typeof PLACEHOLDER_TLDS[number]))
}

/** Returns true when a syntactically valid public URL points at a reserved placeholder host. */
export function isPlaceholderWebsiteUrl(value: string | null | undefined): boolean {
  const normalizedUrl = normalizePublicWebsiteUrl(value)
  if (!normalizedUrl) return false

  return isPlaceholderHostname(new URL(normalizedUrl).hostname)
}

export function getWebsiteDomainStem(value: string | null | undefined): string | null {
  const normalizedUrl = normalizePublicWebsiteUrl(value)
  if (!normalizedUrl) return null

  return getDomainStemFromHostname(new URL(normalizedUrl).hostname)
}

export function displayNameMatchesWebsiteDomain(
  displayName: string | null | undefined,
  website: string | null | undefined,
): boolean {
  const normalizedDisplayName = displayName ? compactText(displayName) : ''
  const domainStem = getWebsiteDomainStem(website)

  if (!normalizedDisplayName || !domainStem) return false

  // Deterministic token matching: ignore protocol, `www.`, case, punctuation,
  // and similar noise by comparing compacted text and token boundaries.
  if (normalizedDisplayName.includes(domainStem)) return true

  const displayTokens = normalizeTextTokens(displayName ?? '')
  return displayTokens.includes(domainStem)
}
