import { Tap, SimpleIndexer } from '@atproto/tap'
import type { TapChannel } from '@atproto/tap'
import { TAP_URL, TAP_ADMIN_PASSWORD, ACTIVITY_COLLECTION } from '../lib/config'
import { scoreActivity } from '../lib/scorer'
import { logActivity } from '../lib/db'
import { enqueueClassification } from '../lib/hf-classifier'
import { applyQualityLabel } from './server'
import logger from './logger'
import type { ActivityRecord } from '../lib/types'

const tapConfig = TAP_ADMIN_PASSWORD ? { adminPassword: TAP_ADMIN_PASSWORD } : undefined
const tap = new Tap(TAP_URL, tapConfig)

const indexer = new SimpleIndexer()

indexer.record(async (evt) => {
  // Only process our collection
  if (evt.collection !== ACTIVITY_COLLECTION) return

  // Skip deletes
  if (evt.action === 'delete') {
    logger.debug({ did: evt.did, rkey: evt.rkey }, 'Skipping delete event')
    return
  }

  if (!evt.record) {
    logger.warn({ did: evt.did, rkey: evt.rkey, action: evt.action }, 'Skipping event with missing record payload')
    return
  }

  const record = evt.record as unknown as ActivityRecord
  const source = evt.live === false ? 'backfill' : 'live'

  // Normalize title once — scorer sees raw value (empty string if absent),
  // logActivity uses 'Untitled' for dashboard display only
  const title = record.title ?? ''

  // Step 1: Score (pure computation — cannot fail from DB issues)
  let result
  try {
    result = scoreActivity({ ...record, title })
  } catch (err) {
    logger.error({ err, did: evt.did, rkey: evt.rkey }, 'Error scoring activity')
    return
  }

  const recordUri = `at://${evt.did}/${ACTIVITY_COLLECTION}/${evt.rkey}`

  // Step 2: Log immediately with scorer result (HF data will be backfilled by background queue)
  try {
    logActivity({
      did: evt.did,
      rkey: evt.rkey,
      uri: recordUri,
      title: title || 'Untitled',
      score: result.totalScore,
      tier: result.tier,
      breakdown: JSON.stringify(result.breakdown),
      testSignals: JSON.stringify(result.testSignals),
      labeledAt: new Date().toISOString(),
    })
    logger.info(
      { did: evt.did, rkey: evt.rkey, score: result.totalScore, tier: result.tier, source },
      `Scored: ${result.totalScore}/100 → ${result.tier}`
    )
  } catch (err) {
    logger.error({ err, did: evt.did, rkey: evt.rkey }, 'Error logging activity')
    return
  }

  // Step 3: Apply AT Proto label immediately (no waiting for HF)
  try {
    await applyQualityLabel(recordUri, result.tier)
  } catch (err) {
    logger.error({ err, uri: recordUri, did: evt.did }, 'Error applying label (score still saved)')
  }

  // Step 4: Fire-and-forget: enqueue HF classification (runs in background, updates DB when done)
  const text = `${record.title ?? ''} ${record.shortDescription ?? ''} ${record.description ?? ''}`.trim()
  enqueueClassification(text, evt.did, evt.rkey)
})

indexer.error((err) => {
  logger.error({ err }, 'SimpleIndexer error')
})

export function startTapConsumer(): { channel: TapChannel; destroy: () => Promise<void> } {
  const channel = tap.channel(indexer)
  // channel.start() returns a promise that resolves when destroyed - do NOT await it
  channel.start().catch((err) => {
    logger.error({ err }, 'Tap channel fatal error — exiting')
    process.exit(1)
  })
  return {
    channel,
    destroy: () => channel.destroy(),
  }
}
