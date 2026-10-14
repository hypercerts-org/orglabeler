import { TEST_PDS_HOSTS } from './config'
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

/** PDS resolution is used only to apply the configured test-PDS override. */
export function actorPdsResolutionEnabled(): boolean {
  return testPdsDetectionEnabled()
}

/** Enqueues actor PDS resolution only when test-PDS detection is configured. */
export function enqueueActorPdsResolution(
  did: string,
  reason: string,
  delayMs = 0,
  options: { force?: boolean; runIds?: string[] } = {},
): void {
  if (!actorPdsResolutionEnabled()) return

  recordActorPdsPending(did, ACTOR_PDS_PENDING_TTL_MS)
  enqueueRecomputeJob('resolve-actor-pds', did, {
    delayMs,
    payload: { reason, ...(options.force ? { force: true } : {}), ...(options.runIds?.length ? { runIds: options.runIds } : {}) },
  })
}

/**
 * Decides whether URL enrichment should run for an actor. When TEST_PDS_HOSTS is
 * configured, URL checks are deferred until the actor PDS cache is fresh because
 * test-PDS actors receive likely-test and URL checks are irrelevant for them.
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
