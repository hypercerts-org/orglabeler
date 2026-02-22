import 'dotenv/config'

export const DID = process.env.DID ?? ''
export const SIGNING_KEY = process.env.SIGNING_KEY ?? ''
export const HOST = process.env.HOST ?? '0.0.0.0'
export const LABELER_PORT = process.env.LABELER_PORT ? Number(process.env.LABELER_PORT) : 4100
export const METRICS_PORT = process.env.METRICS_PORT ? Number(process.env.METRICS_PORT) : 4101
export const BSKY_IDENTIFIER = process.env.BSKY_IDENTIFIER ?? ''
export const BSKY_PASSWORD = process.env.BSKY_PASSWORD ?? ''
export const ACTIVITY_COLLECTION = 'org.hypercerts.claim.activity'
export const ACTIVITY_DB_PATH = process.env.ACTIVITY_DB_PATH ?? 'activity-log.db'
export const LABELS_DB_PATH = process.env.LABELS_DB_PATH ?? 'labels.db'
export const LABELER_ENDPOINT = process.env.LABELER_ENDPOINT ?? ''
export const PDS_URL = process.env.PDS_URL ?? ""
export const TAP_URL = process.env.TAP_URL ?? 'http://localhost:2480'
export const TAP_ADMIN_PASSWORD = process.env.TAP_ADMIN_PASSWORD ?? ''
export const TAP_BIND = process.env.TAP_BIND ?? ':2480'
export const TAP_DB_PATH = process.env.TAP_DB_PATH ?? 'tap.db'
export const HF_TOKEN = process.env.HF_TOKEN ?? ''
export const HF_MODEL = 'facebook/bart-large-mnli'

export function validateLabelerConfig(): void {
  const required: [string, string][] = [
    ['DID', DID],
    ['SIGNING_KEY', SIGNING_KEY],
  ]
  const missing = required.filter(([, val]) => !val).map(([name]) => name)
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}. Check your .env file.`)
  }
}
