import WebSocket from 'ws'
import { FIREHOSE_URL, ACTIVITY_COLLECTION } from '../lib/config'
import { scoreActivity } from '../lib/scorer'
import { applyQualityLabel } from './server'
import { logActivity, updateActivity } from '../lib/db'
import logger from './logger'
import type { ActivityRecord } from '../lib/types'

const PING_INTERVAL = 50_000  // 50s
const PONG_TIMEOUT = 60_000   // 60s
const BACKOFF_MIN = 1_000     // 1s
const BACKOFF_MAX = 120_000   // 2min

interface JetstreamEvent {
  did: string
  time_us: number
  kind: 'commit' | 'identity' | 'account'
  commit?: {
    rev: string
    operation: 'create' | 'update' | 'delete'
    collection: string
    rkey: string
    record?: Record<string, unknown>
    cid?: string
  }
}

function buildUrl(cursor?: number): string {
  const url = new URL(FIREHOSE_URL)
  url.searchParams.append('wantedCollections', ACTIVITY_COLLECTION)
  if (cursor && cursor > 0) {
    url.searchParams.set('cursor', String(cursor))
  }
  return url.toString()
}

async function handleCommit(event: JetstreamEvent): Promise<void> {
  const commit = event.commit!

  // Skip deletes
  if (commit.operation === 'delete') return

  // Safety check: only handle our collection
  if (commit.collection !== ACTIVITY_COLLECTION) return

  const record = commit.record as unknown as ActivityRecord

  // Validate: must have title OR shortDescription
  if (!record.title && !record.shortDescription) {
    logger.warn({ did: event.did, rkey: commit.rkey }, 'Skipping record: no title or description')
    return
  }

  // Phase 1: Detect — log immediately as 'pending'
  logActivity({
    did: event.did,
    rkey: commit.rkey,
    uri: `at://${event.did}/${ACTIVITY_COLLECTION}/${commit.rkey}`,
    title: record.title || 'Untitled',
    score: 0,
    tier: 'pending',
    breakdown: JSON.stringify({}),
    testSignals: JSON.stringify([]),
    labeledAt: new Date().toISOString(),
  })
  logger.info({ did: event.did, rkey: commit.rkey }, 'Activity detected')

  // Phase 2: Evaluate — score and update the pending record
  try {
    const result = scoreActivity(record)
    updateActivity(event.did, commit.rkey, {
      score: result.totalScore,
      tier: result.tier,
      breakdown: JSON.stringify(result.breakdown),
      testSignals: JSON.stringify(result.testSignals),
    })
    logger.info(
      { did: event.did, rkey: commit.rkey, score: result.totalScore, tier: result.tier },
      `Scored: ${result.totalScore}/100 → ${result.tier}`
    )

    // Phase 3: Label — apply AT Proto label, can fail gracefully
    try {
      await applyQualityLabel(event.did, result.tier)
    } catch (err) {
      logger.error({ err, did: event.did }, 'Error applying label (score still saved)')
    }
  } catch (err) {
    logger.error({ err, did: event.did, rkey: commit.rkey }, 'Error scoring activity (record still visible as pending)')
  }
}

export function startJetstreamSubscription(cursor?: number): {
  dispose: () => void
  getCursor: () => number | undefined
} {
  let lastCursor: number | undefined = cursor
  let intentionalClose = false
  let ws: WebSocket | null = null
  let pingTimer: ReturnType<typeof setInterval> | null = null
  let pongTimer: ReturnType<typeof setTimeout> | null = null
  let backoff = BACKOFF_MIN

  function clearTimers() {
    if (pingTimer !== null) {
      clearInterval(pingTimer)
      pingTimer = null
    }
    if (pongTimer !== null) {
      clearTimeout(pongTimer)
      pongTimer = null
    }
  }

  function connect() {
    if (intentionalClose) return

    const url = buildUrl(lastCursor)
    logger.info({ url }, 'Connecting to Jetstream')

    ws = new WebSocket(url)

    ws.on('open', () => {
      logger.info('Jetstream connected')
      backoff = BACKOFF_MIN  // reset backoff on successful connection

      // Start ping/pong keepalive
      pingTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.ping()

          // Set pong timeout — close if no pong received
          pongTimer = setTimeout(() => {
            logger.warn('Pong timeout — closing connection for reconnect')
            ws?.terminate()
          }, PONG_TIMEOUT)
        }
      }, PING_INTERVAL)
    })

    ws.on('pong', () => {
      // Clear pong timeout on receipt
      if (pongTimer !== null) {
        clearTimeout(pongTimer)
        pongTimer = null
      }
    })

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const event = JSON.parse(data.toString()) as JetstreamEvent

        // Track cursor from event time_us
        if (event.time_us) {
          lastCursor = event.time_us
        }

        if (event.kind === 'commit' && event.commit) {
          handleCommit(event).catch((err) => {
            logger.error({ err }, 'Unhandled error in handleCommit')
          })
        }
      } catch (err) {
        logger.error({ err }, 'Failed to parse Jetstream message')
      }
    })

    ws.on('close', (code, reason) => {
      clearTimers()
      if (intentionalClose) {
        logger.info('Jetstream connection closed (intentional)')
        return
      }
      logger.warn({ code, reason: reason.toString() }, `Jetstream disconnected — reconnecting in ${backoff}ms`)
      setTimeout(() => {
        connect()
        backoff = Math.min(backoff * 2, BACKOFF_MAX)
      }, backoff)
    })

    ws.on('error', (err: Error) => {
      logger.error({ err }, 'Jetstream WebSocket error')
      // 'close' event will fire after error, triggering reconnect
    })
  }

  connect()

  return {
    dispose() {
      intentionalClose = true
      clearTimers()
      if (ws) {
        ws.close()
        ws = null
      }
    },
    getCursor() {
      return lastCursor
    },
  }
}
