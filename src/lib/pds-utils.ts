/**
 * Normalizes AT Protocol PDS hostnames for exact configuration matching.
 * Inputs may be bare hosts or full PDS endpoint URLs.
 */
export function normalizePdsHost(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  try {
    const url = trimmed.includes('://')
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`)
    return url.hostname.toLowerCase().replace(/\.+$/, '') || null
  } catch {
    return null
  }
}

/** Returns the normalized hostname for a resolved PDS endpoint URL. */
export function normalizePdsHostFromUrl(pdsUrl: string): string | null {
  return normalizePdsHost(pdsUrl)
}

/** Parses a comma-separated TEST_PDS_HOSTS value into unique normalized hosts. */
export function parseTestPdsHosts(value: string): string[] {
  const hosts = value
    .split(',')
    .map(host => normalizePdsHost(host))
    .filter((host): host is string => host !== null)

  return [...new Set(hosts)]
}

/** Checks whether a PDS host exactly matches one of the configured test hosts. */
export function isConfiguredTestPdsHost(
  pdsHost: string | null | undefined,
  testPdsHosts: readonly string[],
): boolean {
  const normalized = pdsHost ? normalizePdsHost(pdsHost) : null
  return normalized !== null && testPdsHosts.includes(normalized)
}
