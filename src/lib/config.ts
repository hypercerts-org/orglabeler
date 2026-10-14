import { parseTestPdsHosts } from './pds-utils'

export const DID = process.env.DID ?? ''
export const SIGNING_KEY = process.env.SIGNING_KEY ?? ''
export const HOST = process.env.HOST ?? '0.0.0.0'
export const LABELER_PORT = process.env.LABELER_PORT ? Number(process.env.LABELER_PORT) : 4100
export const METRICS_PORT = process.env.METRICS_PORT ? Number(process.env.METRICS_PORT) : 4101
export const LABELER_IDENTIFIER = process.env.LABELER_IDENTIFIER ?? ''
export const LABELER_PASSWORD = process.env.LABELER_PASSWORD ?? ''
export const PROFILE_COLLECTION = 'app.certified.actor.profile'
export const ORGANIZATION_COLLECTION = 'app.certified.actor.organization'
export const ACTIVITY_COLLECTION = ORGANIZATION_COLLECTION
export const ACTIVITY_DB_PATH = process.env.ACTIVITY_DB_PATH ?? '/data/activity-log.db'
export const LABELS_DB_PATH = process.env.LABELS_DB_PATH ?? '/data/labels.db'
export const APP_DB_PATHS = [ACTIVITY_DB_PATH, LABELS_DB_PATH] as const
export const NEXT_PUBLIC_LABELER_ENDPOINT = process.env.NEXT_PUBLIC_LABELER_ENDPOINT ?? ''
export const PDS_URL = process.env.PDS_URL ?? ''
export const TAP_URL = process.env.TAP_URL ?? ''
export const TAP_ADMIN_PASSWORD = process.env.TAP_ADMIN_PASSWORD ?? ''
export const TYPESAFE_API_KEY = process.env.TYPESAFE_API_KEY?.trim() ?? ''
export const JEV_MODEL = process.env.JEV_MODEL?.trim() || 'jev-latest'
export const JEV_REQUEST_TIMEOUT_MS = integerEnv('JEV_REQUEST_TIMEOUT_MS', 15_000)
export const JEV_TEST_THRESHOLD = probabilityEnv('JEV_TEST_THRESHOLD', 0.98)
export const JEV_MAX_TEST_PROBABILITY_FOR_QUALITY = probabilityEnv('JEV_MAX_TEST_PROBABILITY_FOR_QUALITY', 0.02)
export const JEV_PURPOSE_THRESHOLD = probabilityEnv('JEV_PURPOSE_THRESHOLD', 0.95)
export const JEV_QUALITY_THRESHOLD = probabilityEnv('JEV_QUALITY_THRESHOLD', 0.95)
export const HYPERSCAN_RECORD_URL_BASE = process.env.HYPERSCAN_RECORD_URL_BASE ?? 'https://hyperscan.dev/data'
/** Comma-separated PDS hosts whose actors should always be labeled likely-test. */
export const TEST_PDS_HOSTS = parseTestPdsHosts(process.env.TEST_PDS_HOSTS ?? '')
export const ADMIN_DIDS_CONFIG = parseAdminDidAllowlist(process.env.ADMIN_DIDS ?? '')
export const ADMIN_DIDS = ADMIN_DIDS_CONFIG.dids
export const ADMIN_ORIGIN = parseAdminOrigin(process.env.ADMIN_ORIGIN ?? '')
export const ADMIN_SESSION_TTL_MS = integerEnv('ADMIN_SESSION_TTL_MS', 8 * 60 * 60 * 1000)
export const ADMIN_OAUTH_SIGNING_KEY = process.env.ADMIN_OAUTH_SIGNING_KEY ?? ''
export const ADMIN_OAUTH_ENCRYPTION_KEY = process.env.ADMIN_OAUTH_ENCRYPTION_KEY ?? ''
export const ADMIN_OAUTH_STATE_TTL_MS = 10 * 60 * 1000
export const ADMIN_SESSION_COOKIE_SECURE =
  ADMIN_ORIGIN === null ||
  ADMIN_ORIGIN.startsWith('https://') ||
  process.env.NODE_ENV === 'production'
function integerEnv(name: string, fallback: number): number {
  const value = process.env[name]
  if (!value) return fallback

  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function parseAdminDidAllowlist(value: string): { dids: string[]; error: string | null } {
  const entries = value.split(',').map(entry => entry.trim()).filter(Boolean)
  if (entries.length === 0) return { dids: [], error: 'ADMIN_DIDS is not configured' }
  if (entries.some(did => !/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(did))) {
    return { dids: [], error: 'ADMIN_DIDS contains an invalid DID' }
  }
  return { dids: [...new Set(entries)], error: null }
}

export function parseAdminOrigin(value: string): string | null {
  const configured = value.trim()
  if (!configured) return null

  try {
    const parsed = new URL(configured)
    const isLocalHttp = parsed.protocol === 'http:' && parsed.hostname === 'localhost'
    if (
      (parsed.protocol !== 'https:' && !isLocalHttp) ||
      parsed.origin !== configured ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    ) return null
    return parsed.origin
  } catch {
    return null
  }
}

function probabilityEnv(name: string, fallback: number): number {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') return fallback

  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback
}

/** Disables external URL checks while retaining cached evidence for assessments. */
export const URL_ENRICHMENT_ENABLED = process.env.URL_ENRICHMENT_ENABLED !== 'false'
/** Poll interval for checking one due URL cache row. */
export const URL_CHECK_INTERVAL_MS = integerEnv('URL_CHECK_INTERVAL_MS', 1000)
/** How often the URL worker scans local snapshots for newly referenced URLs. */
export const URL_CHECK_DISCOVERY_INTERVAL_MS = integerEnv('URL_CHECK_DISCOVERY_INTERVAL_MS', 30_000)
/** Maximum wall-clock time for a single URL resolution attempt. */
export const URL_CHECK_TIMEOUT_MS = integerEnv('URL_CHECK_TIMEOUT_MS', 4000)
/** How long a successful URL resolution remains fresh before rechecking. */
export const URL_CHECK_OK_TTL_MS = integerEnv('URL_CHECK_OK_TTL_MS', 7 * 24 * 60 * 60 * 1000)
/** How long a hard failed URL remains downgraded before another attempt. */
export const URL_CHECK_FAILED_TTL_MS = integerEnv('URL_CHECK_FAILED_TTL_MS', 24 * 60 * 60 * 1000)
/** Initial retry delay for temporary URL failures. */
export const URL_CHECK_RETRY_BASE_MS = integerEnv('URL_CHECK_RETRY_BASE_MS', 5 * 60 * 1000)
/** Maximum retry delay for temporary URL failures. */
export const URL_CHECK_MAX_RETRY_MS = integerEnv('URL_CHECK_MAX_RETRY_MS', 60 * 60 * 1000)
/** Number of hard failures required before URL evidence is recorded as failed. */
export const URL_CHECK_HARD_FAILURE_ATTEMPTS = integerEnv('URL_CHECK_HARD_FAILURE_ATTEMPTS', 2)
/** Maximum profile/organization URLs to cache and check per DID. */
export const URL_CHECK_MAX_URLS_PER_DID = integerEnv('URL_CHECK_MAX_URLS_PER_DID', 5)

export function validateLabelerConfig(): void {
  const required: [string, string][] = [
    ['DID', DID],
    ['SIGNING_KEY', SIGNING_KEY],
    ['TAP_URL', TAP_URL],
  ]
  const missing = required.filter(([, val]) => !val).map(([name]) => name)
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. TAP_URL must point to the external Tap service; there is no localhost default. Check your .env file.`,
    )
  }
}
