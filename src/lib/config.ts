import 'dotenv/config'

export const DID = process.env.DID ?? ''
export const SIGNING_KEY = process.env.SIGNING_KEY ?? ''
export const HOST = process.env.HOST ?? '0.0.0.0'
export const LABELER_PORT = process.env.LABELER_PORT ? Number(process.env.LABELER_PORT) : 4100
export const METRICS_PORT = process.env.METRICS_PORT ? Number(process.env.METRICS_PORT) : 4101
export const FIREHOSE_URL = process.env.FIREHOSE_URL ?? 'wss://jetstream2.us-west.bsky.network/subscribe'
export const CURSOR_UPDATE_INTERVAL = process.env.CURSOR_UPDATE_INTERVAL ? Number(process.env.CURSOR_UPDATE_INTERVAL) : 60000
export const BSKY_IDENTIFIER = process.env.BSKY_IDENTIFIER ?? ''
export const BSKY_PASSWORD = process.env.BSKY_PASSWORD ?? ''
export const ACTIVITY_COLLECTION = 'org.hypercerts.claim.activity'
export const ACTIVITY_DB_PATH = process.env.ACTIVITY_DB_PATH ?? 'activity-log.db'
export const LABELER_ENDPOINT = process.env.LABELER_ENDPOINT ?? ''
export const PDS_URL = process.env.PDS_URL ?? ""
