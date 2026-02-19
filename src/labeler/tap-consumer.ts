import { Tap, SimpleIndexer } from '@atproto/tap'
import type { TapChannel } from '@atproto/tap'
import { TAP_URL, TAP_ADMIN_PASSWORD, ACTIVITY_COLLECTION } from '../lib/config'
import { scoreActivity } from '../lib/scorer'
import { logActivity, updateActivity } from '../lib/db'
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

  const isBackfill = evt.live === false
  const isLive = evt.live === true
  if (isBackfill) {
    logger.debug({ did: evt.did, rkey: evt.rkey }, 'Processing backfill event')
  } else if (isLive) {
    logger.debug({ did: evt.did, rkey: evt.rkey }, 'Processing live event')
  }

  if (!evt.record) {
    logger.warn({ did: evt.did, rkey: evt.rkey, action: evt.action }, 'Skipping event with missing record payload')
    return
  }
  const record = evt.record as unknown as ActivityRecord

  // Phase 1: Detect — log immediately as 'pending'
  try {
    logActivity({
      did: evt.did,
      rkey: evt.rkey,
      uri: `at://${evt.did}/${ACTIVITY_COLLECTION}/${evt.rkey}`,
      title: record.title || 'Untitled',
      score: 0,
      tier: 'pending',
      breakdown: JSON.stringify({}),
      testSignals: JSON.stringify([]),
      labeledAt: new Date().toISOString(),
    })
    logger.info({ did: evt.did, rkey: evt.rkey }, 'Activity detected')
  } catch (err) {
    logger.error({ err, did: evt.did, rkey: evt.rkey }, 'Error logging activity (phase 1)')
    return
  }

  // Phase 2: Evaluate — score and update the pending record
  try {
    const result = scoreActivity(record)
    updateActivity(evt.did, evt.rkey, {
      score: result.totalScore,
      tier: result.tier,
      breakdown: JSON.stringify(result.breakdown),
      testSignals: JSON.stringify(result.testSignals),
    })
    logger.info(
      { did: evt.did, rkey: evt.rkey, score: result.totalScore, tier: result.tier },
      `Scored: ${result.totalScore}/100 → ${result.tier}`
    )

    // Phase 3: Label — apply AT Proto label, can fail gracefully
    try {
      await applyQualityLabel(evt.did, result.tier)
    } catch (err) {
      logger.error({ err, did: evt.did }, 'Error applying label (score still saved)')
    }
  } catch (err) {
    logger.error({ err, did: evt.did, rkey: evt.rkey }, 'Error scoring activity (record still visible as pending)')
  }
})

indexer.error((err) => {
  logger.error({ err }, 'SimpleIndexer error')
})

export function startTapConsumer(): { channel: TapChannel; destroy: () => Promise<void> } {
  const channel = tap.channel(indexer)
  // channel.start() returns a promise that resolves when destroyed - do NOT await it
  channel.start().catch((err) => {
    logger.error({ err }, 'Tap channel error')
  })
  return {
    channel,
    destroy: () => channel.destroy(),
  }
}
