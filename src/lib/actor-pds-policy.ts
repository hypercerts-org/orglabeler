import { TEST_PDS_HOSTS, TRUSTED_PDS_BONUS, TRUSTED_PDS_HOSTS } from './config'
import {
  enqueueRecomputeJob,
  getActorPdsCache,
  isActorPdsCacheStale,
  recordActorPdsPending,
} from './db'
import { isConfiguredTestPdsHost } from './pds-utils'

/** How long a pending DID → PDS lookup should suppress duplicate refreshes. */
export const ACTOR_PDS_PENDING_TTL_MS = 5 * 60 * 1000

/** How long a successful DID → PDS lookup stays fresh before refresh. */
export const ACTOR_PDS_CACHE_TTL_MS = 24 * 60 * 60 * 1000

/** Returns true when actor-PDS test labeling is configured for this process. */
export function testPdsDetectionEnabled(): boolean {
  return TEST_PDS_HOSTS.length > 0
}

/** Returns true when trusted-PDS scoring can affect the final score. */
export function trustedPdsBonusEnabled(): boolean {
  return TRUSTED_PDS_HOSTS.length > 0 && TRUSTED_PDS_BONUS > 0
}

/** Returns true when actor PDS lookup is needed for any scoring policy. */
export function actorPdsResolutionEnabled(): boolean {
  return testPdsDetectionEnabled() || trustedPdsBonusEnabled()
}

/** Enqueues actor PDS resolution when any actor-PDS scoring policy is configured. */
export function enqueueActorPdsResolution(did: string, reason: string, delayMs = 0): void {
  if (!actorPdsResolutionEnabled()) return

  recordActorPdsPending(did, ACTOR_PDS_PENDING_TTL_MS)
  enqueueRecomputeJob('resolve-actor-pds', did, {
    delayMs,
    payload: { reason },
  })
}

/**
 * Returns the best cached actor PDS host for scoring. Stale hosts are still used
 * for the current score, but a refresh is queued so later recomputes can correct
 * trusted-PDS bonuses or test-PDS labels.
 */
export function cachedActorPdsHostForScoring(did: string): string | null {
  if (!actorPdsResolutionEnabled()) return null

  const cache = getActorPdsCache(did)
  if (!cache || isActorPdsCacheStale(cache)) {
    enqueueActorPdsResolution(did, cache ? 'recompute-stale-pds-cache' : 'recompute-pds-cache-miss')
  }

  return cache?.pdsHost ?? null
}

/**
 * Decides whether URL enrichment should run for an actor. When TEST_PDS_HOSTS is
 * configured, URL checks are deferred until the actor PDS cache is fresh because
 * test-PDS actors are always likely-test and URL scoring is irrelevant for them.
 */
export function shouldRunUrlEnrichmentForDid(did: string): boolean {
  if (!testPdsDetectionEnabled()) return true

  const cache = getActorPdsCache(did)
  if (!cache || isActorPdsCacheStale(cache)) {
    enqueueActorPdsResolution(did, cache ? 'url-enrichment-stale-pds-cache' : 'url-enrichment-pds-cache-miss')
    return false
  }

  if (cache.status !== 'ok' || !cache.pdsHost) return false

  return !isConfiguredTestPdsHost(cache.pdsHost, TEST_PDS_HOSTS)
}
