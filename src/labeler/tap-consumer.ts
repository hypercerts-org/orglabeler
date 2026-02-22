import { Tap, SimpleIndexer } from '@atproto/tap'
import type { TapChannel } from '@atproto/tap'
import { TAP_URL, TAP_ADMIN_PASSWORD, ACTIVITY_COLLECTION } from '../lib/config'
import { scoreActivity, tierForScore } from '../lib/scorer'
import { logActivity } from '../lib/db'
import { classifyContent, isLowQualityContent } from '../lib/hf-classifier'
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

  // Step 2: Async HF classification (non-blocking — never crashes pipeline)
  const text = `${record.title ?? ''} ${record.shortDescription ?? ''} ${record.description ?? ''}`.trim()
  const classification = await classifyContent(text)
  console.log('[hf]', recordUri, classification?.label, classification?.score)

  let finalTier = result.tier
  let finalTestSignals = result.testSignals
  let hfLabel: string | null = null
  let hfScore: number | null = null

  if (classification !== null) {
    hfLabel = classification.label
    hfScore = classification.score
    if (isLowQualityContent(classification)) {
      finalTestSignals = [
        ...result.testSignals,
        `hf-flagged: ${classification.label} (${(classification.score * 100).toFixed(0)}%)`,
      ]
      finalTier = tierForScore(result.totalScore, finalTestSignals)
    }
  }

  // Step 3: Log with final score (single atomic write)
  try {
    logActivity({
      did: evt.did,
      rkey: evt.rkey,
      uri: recordUri,
      title: title || 'Untitled',
      score: result.totalScore,
      tier: finalTier,
      breakdown: JSON.stringify(result.breakdown),
      testSignals: JSON.stringify(finalTestSignals),
      labeledAt: new Date().toISOString(),
    }, { hfLabel, hfScore })
    logger.info(
      { did: evt.did, rkey: evt.rkey, score: result.totalScore, tier: finalTier, source },
      `Scored: ${result.totalScore}/100 → ${finalTier}`
    )
  } catch (err) {
    logger.error({ err, did: evt.did, rkey: evt.rkey }, 'Error logging activity')
    return
  }

  // Step 4: Apply AT Proto label (can fail gracefully)
  try {
    await applyQualityLabel(recordUri, finalTier)
  } catch (err) {
    logger.error({ err, uri: recordUri, did: evt.did }, 'Error applying label (score still saved)')
  }
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
