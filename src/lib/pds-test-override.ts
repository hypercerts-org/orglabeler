import { TEST_PDS_HOSTS } from './config'
import { isConfiguredTestPdsHost, normalizePdsHost } from './pds-utils'
import { tierForScore } from './scorer'
import type { ScoreResult } from './types'

/** Stable prefix for test signals created from configured actor PDS hosts. */
export const PDS_TEST_SIGNAL_PREFIX = 'actor-pds-test-host:'

/** Builds the dashboard-visible test signal for a matching actor PDS host. */
export function pdsTestSignal(pdsHost: string): string {
  return `${PDS_TEST_SIGNAL_PREFIX} ${pdsHost}`
}

/** Removes stale PDS signals and adds the current one when the host is configured as test. */
export function updatePdsTestSignals(
  testSignals: string[],
  pdsHost: string | null | undefined,
  testPdsHosts: readonly string[] = TEST_PDS_HOSTS,
): string[] {
  const withoutPdsSignals = testSignals.filter(signal => !signal.startsWith(PDS_TEST_SIGNAL_PREFIX))
  const normalizedHost = pdsHost ? normalizePdsHost(pdsHost) : null

  if (normalizedHost === null || !isConfiguredTestPdsHost(normalizedHost, testPdsHosts)) {
    return withoutPdsSignals
  }

  return [...withoutPdsSignals, pdsTestSignal(normalizedHost)]
}

/**
 * Applies the configured actor-PDS test override to a score result. The numeric
 * score and breakdown stay unchanged; only test signals and the derived tier can change.
 */
export function applyPdsTestOverride<TScore extends ScoreResult>(
  result: TScore,
  pdsHost: string | null | undefined,
  testPdsHosts: readonly string[] = TEST_PDS_HOSTS,
): TScore {
  const updatedSignals = updatePdsTestSignals(result.testSignals, pdsHost, testPdsHosts)

  return {
    ...result,
    tier: tierForScore(result.totalScore, updatedSignals),
    testSignals: updatedSignals,
  } as TScore
}
