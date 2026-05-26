import { lookup } from 'node:dns/promises'

import {
  URL_CHECK_DISCOVERY_INTERVAL_MS,
  URL_CHECK_FAILED_TTL_MS,
  URL_CHECK_HARD_FAILURE_ATTEMPTS,
  URL_CHECK_INTERVAL_MS,
  URL_CHECK_MAX_RETRY_MS,
  URL_CHECK_MAX_URLS_PER_DID,
  URL_CHECK_OK_TTL_MS,
  URL_CHECK_RETRY_BASE_MS,
  URL_CHECK_TIMEOUT_MS,
  URL_ENRICHMENT_ENABLED,
} from '../lib/config'
import {
  enqueueRecomputeJob,
  getAllOrganizationSnapshots,
  getDueUrlCheck,
  getOrganizationSnapshot,
  getProfileSnapshot,
  getUrlCheckCounts,
  getUrlResolutionMap,
  recordUrlCheckFailure,
  recordUrlCheckOk,
  upsertPendingUrlCheck,
  type UrlCheck,
} from '../lib/db'
import { isPublicNetworkAddress, normalizePublicWebsiteUrl } from '../lib/website-utils'
import type { UrlResolutionMap, UrlResolutionState } from '../lib/scoring-input'
import logger from './logger'

const URL_RECOMPUTE_DELAY_MS = 0
const URL_CHECK_USER_AGENT = 'orglabeler-url-enrichment/1.0'
const URL_CHECK_MAX_REDIRECTS = 5

type UrlCheckOutcome =
  | { kind: 'ok'; statusCode: number | null }
  | { kind: 'hard-failure'; statusCode: number | null; error: string }
  | { kind: 'temporary-failure'; statusCode: number | null; error: string }

function retryDelayForAttempt(attempts: number): number {
  const exponent = Math.max(0, attempts - 1)
  return Math.min(URL_CHECK_MAX_RETRY_MS, URL_CHECK_RETRY_BASE_MS * (2 ** exponent))
}

function resolutionStateForCheck(check: UrlCheck): UrlResolutionState {
  if (check.status === 'ok') return 'ok'
  if (check.status === 'failed') return 'failed'
  return 'unknown'
}

function uniqueNormalizedUrls(urls: Array<string | null | undefined>): string[] {
  const normalized = urls
    .map(url => normalizePublicWebsiteUrl(url))
    .filter((url): url is string => Boolean(url))

  return [...new Set(normalized)]
}

function collectRawUrlsForDid(did: string): Array<string | null | undefined> {
  const organization = getOrganizationSnapshot(did)
  if (!organization) return []

  const profile = getProfileSnapshot(did)
  const urls: Array<string | null | undefined> = [profile?.payload.website]

  for (const item of organization.payload.urls ?? []) {
    if (urls.length >= URL_CHECK_MAX_URLS_PER_DID) break
    urls.push(item?.url)
  }

  return urls.slice(0, URL_CHECK_MAX_URLS_PER_DID)
}

/** Returns the normalized public URLs currently referenced by a DID's local snapshots. */
export function collectNormalizedUrlsForDid(did: string): string[] {
  return uniqueNormalizedUrls(collectRawUrlsForDid(did))
}

/**
 * Creates pending URL cache rows for the DID's current snapshots.
 * This is safe to call after every recompute because fresh cache rows are not reset.
 */
export function enqueueUrlChecksForDid(did: string): number {
  if (!URL_ENRICHMENT_ENABLED) return 0

  const urls = collectNormalizedUrlsForDid(did)
  for (const url of urls) {
    upsertPendingUrlCheck(url)
  }
  return urls.length
}

/** Reads cached URL resolution states for scoring; missing rows remain optimistic unknowns. */
export function getUrlResolutionMapForDid(did: string): UrlResolutionMap {
  if (!URL_ENRICHMENT_ENABLED) return {}

  return getUrlResolutionMap(collectNormalizedUrlsForDid(did))
}

function discoverUrlChecksFromSnapshots(): number {
  const snapshots = getAllOrganizationSnapshots()
  let discovered = 0

  for (const snapshot of snapshots) {
    discovered += enqueueUrlChecksForDid(snapshot.did)
  }

  return discovered
}

function didReferencesNormalizedUrl(did: string, normalizedUrl: string): boolean {
  return collectNormalizedUrlsForDid(did).includes(normalizedUrl)
}

function getDidsReferencingUrl(normalizedUrl: string): string[] {
  return getAllOrganizationSnapshots()
    .map(snapshot => snapshot.did)
    .filter(did => didReferencesNormalizedUrl(did, normalizedUrl))
}

function isOkStatus(status: number): boolean {
  return (status >= 200 && status < 400) || status === 401 || status === 403 || status === 405
}

function isHardFailureStatus(status: number): boolean {
  return status === 404 || status === 410
}

async function lookupHostAddresses(hostname: string): Promise<Array<{ address: string }>> {
  let timeout: NodeJS.Timeout | null = null

  try {
    return await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`DNS lookup timed out after ${URL_CHECK_TIMEOUT_MS}ms for ${hostname}`)), URL_CHECK_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function assertPublicResolvedHost(normalizedUrl: string): Promise<void> {
  const hostname = new URL(normalizedUrl).hostname

  if (isPublicNetworkAddress(hostname)) return

  const addresses = await lookupHostAddresses(hostname)
  if (addresses.length === 0) {
    throw new Error(`DNS lookup returned no addresses for ${hostname}`)
  }

  const privateAddress = addresses.find(address => !isPublicNetworkAddress(address.address))
  if (privateAddress) {
    throw new Error(`URL host resolved to non-public address ${privateAddress.address}`)
  }
}

function normalizeRedirectTarget(location: string | null, currentUrl: string): string | null {
  if (!location) return null

  try {
    return normalizePublicWebsiteUrl(new URL(location, currentUrl).toString())
  } catch {
    return null
  }
}

async function fetchUrl(url: string, method: 'HEAD' | 'GET', signal: AbortSignal): Promise<Response> {
  let currentUrl = url

  for (let redirectCount = 0; redirectCount <= URL_CHECK_MAX_REDIRECTS; redirectCount++) {
    await assertPublicResolvedHost(currentUrl)

    const response = await fetch(currentUrl, {
      method,
      redirect: 'manual',
      signal,
      headers: {
        'User-Agent': URL_CHECK_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...(method === 'GET' ? { Range: 'bytes=0-0' } : {}),
      },
    })

    if (response.status < 300 || response.status >= 400) {
      return response
    }

    const nextUrl = normalizeRedirectTarget(response.headers.get('location'), currentUrl)
    await response.body?.cancel()

    if (!nextUrl) {
      throw new Error(`Unsafe or missing redirect target from ${currentUrl}`)
    }

    currentUrl = nextUrl
  }

  throw new Error(`Too many redirects from ${url}`)
}

async function resolveUrl(normalizedUrl: string): Promise<UrlCheckOutcome> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), URL_CHECK_TIMEOUT_MS)

  try {
    let response = await fetchUrl(normalizedUrl, 'HEAD', controller.signal)
    await response.body?.cancel()

    if (response.status === 405 || response.status === 501) {
      response = await fetchUrl(normalizedUrl, 'GET', controller.signal)
      await response.body?.cancel()
    }

    if (isOkStatus(response.status)) {
      return { kind: 'ok', statusCode: response.status }
    }

    if (isHardFailureStatus(response.status)) {
      return {
        kind: 'hard-failure',
        statusCode: response.status,
        error: `HTTP ${response.status}`,
      }
    }

    return {
      kind: 'temporary-failure',
      statusCode: response.status,
      error: `HTTP ${response.status}`,
    }
  } catch (err) {
    const aborted = controller.signal.aborted
    const message = aborted
      ? `Timed out after ${URL_CHECK_TIMEOUT_MS}ms`
      : err instanceof Error
        ? err.message
        : String(err)

    return {
      kind: 'temporary-failure',
      statusCode: null,
      error: message,
    }
  } finally {
    clearTimeout(timeout)
  }
}

function saveUrlCheckOutcome(check: UrlCheck, outcome: UrlCheckOutcome): UrlResolutionState {
  if (outcome.kind === 'ok') {
    recordUrlCheckOk(check.normalizedUrl, outcome.statusCode, URL_CHECK_OK_TTL_MS)
    return 'ok'
  }

  const attempts = check.attempts + 1
  const hardFailed = outcome.kind === 'hard-failure' && attempts >= URL_CHECK_HARD_FAILURE_ATTEMPTS

  if (hardFailed) {
    recordUrlCheckFailure({
      normalizedUrl: check.normalizedUrl,
      status: 'failed',
      resolvable: false,
      statusCode: outcome.statusCode,
      error: outcome.error,
      attempts,
      retryAfterMs: URL_CHECK_FAILED_TTL_MS,
    })
    return 'failed'
  }

  recordUrlCheckFailure({
    normalizedUrl: check.normalizedUrl,
    status: 'pending',
    resolvable: null,
    statusCode: outcome.statusCode,
    error: outcome.error,
    attempts,
    retryAfterMs: retryDelayForAttempt(attempts),
  })
  return 'unknown'
}

async function processDueUrlCheck(check: UrlCheck): Promise<void> {
  const beforeState = resolutionStateForCheck(check)
  const outcome = await resolveUrl(check.normalizedUrl)
  const afterState = saveUrlCheckOutcome(check, outcome)

  logger.info(
    {
      url: check.normalizedUrl,
      outcome: outcome.kind,
      statusCode: outcome.statusCode,
      attempts: outcome.kind === 'ok' ? 0 : check.attempts + 1,
      beforeState,
      afterState,
    },
    'Processed URL enrichment check',
  )

  if (beforeState === afterState) return

  const dids = getDidsReferencingUrl(check.normalizedUrl)
  for (const did of dids) {
    enqueueRecomputeJob('recompute-org', did, {
      delayMs: URL_RECOMPUTE_DELAY_MS,
      payload: { reason: 'url-enrichment', url: check.normalizedUrl },
    })
  }

  if (dids.length > 0) {
    logger.info({ url: check.normalizedUrl, dids, beforeState, afterState }, 'Queued recompute after URL enrichment state changed')
  }
}

/** Starts the detachable URL enrichment loop that checks cached URLs outside Tap handling. */
export function startUrlEnrichmentWorker(): { destroy: () => void } {
  if (!URL_ENRICHMENT_ENABLED) {
    logger.info('URL enrichment worker disabled')
    return { destroy: () => undefined }
  }

  let stopped = false
  let running = false
  let timer: NodeJS.Timeout | null = null
  let lastDiscoveryAt = 0

  const tick = async (): Promise<void> => {
    if (stopped || running) return
    running = true

    try {
      const now = Date.now()
      if (now - lastDiscoveryAt >= URL_CHECK_DISCOVERY_INTERVAL_MS) {
        const discovered = discoverUrlChecksFromSnapshots()
        lastDiscoveryAt = now
        if (discovered > 0) {
          logger.debug({ discovered }, 'Discovered URLs from organization snapshots')
        }
      }

      const check = getDueUrlCheck()
      if (!check) return

      await processDueUrlCheck(check)
    } finally {
      running = false
    }
  }

  timer = setInterval(() => {
    tick().catch(err => logger.error({ err }, 'URL enrichment worker tick failed'))
  }, URL_CHECK_INTERVAL_MS)

  logger.info({ counts: getUrlCheckCounts() }, 'URL enrichment worker started')
  tick().catch(err => logger.error({ err }, 'Initial URL enrichment worker tick failed'))

  return {
    destroy: () => {
      stopped = true
      if (timer) clearInterval(timer)
      logger.info({ counts: getUrlCheckCounts() }, 'URL enrichment worker stopped')
    },
  }
}
