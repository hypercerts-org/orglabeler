import 'dotenv/config'

export const DID = process.env.DID ?? ''
export const SIGNING_KEY = process.env.SIGNING_KEY ?? ''
export const HOST = process.env.HOST ?? '0.0.0.0'
export const LABELER_PORT = process.env.LABELER_PORT ? Number(process.env.LABELER_PORT) : 4100
export const METRICS_PORT = process.env.METRICS_PORT ? Number(process.env.METRICS_PORT) : 4101
export const BSKY_IDENTIFIER = process.env.BSKY_IDENTIFIER ?? ''
export const BSKY_PASSWORD = process.env.BSKY_PASSWORD ?? ''
export const ACTIVITY_COLLECTION = 'app.certified.actor.organization'
export const ACTIVITY_DB_PATH = process.env.ACTIVITY_DB_PATH ?? '/data/activity-log.db'
export const LABELS_DB_PATH = process.env.LABELS_DB_PATH ?? '/data/labels.db'
export const APP_DB_PATHS = [ACTIVITY_DB_PATH, LABELS_DB_PATH] as const
export const LABELER_ENDPOINT = process.env.LABELER_ENDPOINT ?? ''
export const PDS_URL = process.env.PDS_URL ?? ''
export const TAP_URL = process.env.TAP_URL ?? ''
export const TAP_HEALTH_URL = normalizeTapHealthUrl(process.env.TAP_HEALTH_URL) ?? deriveTapHealthUrl(TAP_URL) ?? ''
export const TAP_ADMIN_PASSWORD = process.env.TAP_ADMIN_PASSWORD ?? ''
export const HF_TOKEN = process.env.HF_TOKEN ?? ''
export const HF_MODEL = 'facebook/bart-large-mnli'

function normalizeTapHealthUrl(value: string | undefined): string | null {
  if (!value) return null

  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function deriveTapHealthUrl(tapUrl: string): string | null {
  if (!tapUrl) return null

  try {
    const url = new URL(tapUrl)

    if (url.protocol === 'ws:') {
      url.protocol = 'http:'
    } else if (url.protocol === 'wss:') {
      url.protocol = 'https:'
    } else {
      return null
    }

    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

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

  if (process.env.TAP_HEALTH_URL && !isHttpUrl(TAP_HEALTH_URL)) {
    throw new Error('Invalid TAP_HEALTH_URL: must be a valid http:// or https:// URL')
  }

  if (!TAP_HEALTH_URL) {
    throw new Error(
      'Invalid TAP_URL: must use ws:// or wss:// so a health URL can be derived, or set TAP_HEALTH_URL to an http(s) URL',
    )
  }
}
