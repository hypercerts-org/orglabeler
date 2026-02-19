import { Jetstream } from '@skyware/jetstream'
import type { CommitCreateEvent, CommitUpdateEvent } from '@skyware/jetstream'
import { FIREHOSE_URL, ACTIVITY_COLLECTION } from '../lib/config'
import { scoreActivity } from '../lib/scorer'
import { applyQualityLabel } from './server'
import { logActivity, updateActivity } from '../lib/db'
import logger from './logger'
import type { ActivityRecord } from '../lib/types'

export function createJetstream(cursor: number): Jetstream {
  return new Jetstream({
    wantedCollections: [ACTIVITY_COLLECTION],
    endpoint: FIREHOSE_URL,
    cursor,
  })
}

export function setupHandlers(jetstream: Jetstream): void {
  jetstream.onCreate(ACTIVITY_COLLECTION, async (event: CommitCreateEvent<typeof ACTIVITY_COLLECTION>) => {
    const record = event.commit.record as unknown as ActivityRecord

    // Validate: must have title OR shortDescription
    if (!record.title && !record.shortDescription) {
      logger.warn({ did: event.did, rkey: event.commit.rkey }, 'Skipping record: no title or description')
      return
    }

    // Phase 1: Detect — log immediately as 'pending'
    logActivity({
      did: event.did,
      rkey: event.commit.rkey,
      uri: `at://${event.did}/${ACTIVITY_COLLECTION}/${event.commit.rkey}`,
      title: record.title || 'Untitled',
      score: 0,
      tier: 'pending',
      breakdown: JSON.stringify({}),
      testSignals: JSON.stringify([]),
      labeledAt: new Date().toISOString(),
    })
    logger.info({ did: event.did, rkey: event.commit.rkey }, 'Activity detected')

    // Phase 2: Evaluate — score and update the pending record
    let tier: string = 'pending'
    try {
      const result = scoreActivity(record)
      tier = result.tier
      updateActivity(event.did, event.commit.rkey, {
        score: result.totalScore,
        tier: result.tier,
        breakdown: JSON.stringify(result.breakdown),
        testSignals: JSON.stringify(result.testSignals),
      })
      logger.info(
        { did: event.did, rkey: event.commit.rkey, score: result.totalScore, tier: result.tier },
        `Scored: ${result.totalScore}/100 → ${result.tier}`
      )

      // Phase 3: Label — apply AT Proto label, can fail gracefully
      try {
        await applyQualityLabel(event.did, result.tier)
      } catch (err) {
        logger.error({ err, did: event.did }, 'Error applying label (score still saved)')
      }
    } catch (err) {
      logger.error({ err, did: event.did, rkey: event.commit.rkey }, 'Error scoring activity (record still visible as pending)')
    }
  })

  jetstream.onUpdate(ACTIVITY_COLLECTION, async (event: CommitUpdateEvent<typeof ACTIVITY_COLLECTION>) => {
    const record = event.commit.record as unknown as ActivityRecord

    // Validate: must have title OR shortDescription
    if (!record.title && !record.shortDescription) {
      logger.warn({ did: event.did, rkey: event.commit.rkey }, 'Skipping record: no title or description')
      return
    }

    // Phase 1: Detect — reset to 'pending' via upsert (INSERT OR REPLACE)
    logActivity({
      did: event.did,
      rkey: event.commit.rkey,
      uri: `at://${event.did}/${ACTIVITY_COLLECTION}/${event.commit.rkey}`,
      title: record.title || 'Untitled',
      score: 0,
      tier: 'pending',
      breakdown: JSON.stringify({}),
      testSignals: JSON.stringify([]),
      labeledAt: new Date().toISOString(),
    })
    logger.info({ did: event.did, rkey: event.commit.rkey }, 'Activity detected')

    // Phase 2: Evaluate — score and update the pending record
    try {
      const result = scoreActivity(record)
      updateActivity(event.did, event.commit.rkey, {
        score: result.totalScore,
        tier: result.tier,
        breakdown: JSON.stringify(result.breakdown),
        testSignals: JSON.stringify(result.testSignals),
      })
      logger.info(
        { did: event.did, rkey: event.commit.rkey, score: result.totalScore, tier: result.tier },
        `Scored: ${result.totalScore}/100 → ${result.tier}`
      )

      // Phase 3: Label — apply AT Proto label, can fail gracefully
      try {
        await applyQualityLabel(event.did, result.tier)
      } catch (err) {
        logger.error({ err, did: event.did }, 'Error applying label (score still saved)')
      }
    } catch (err) {
      logger.error({ err, did: event.did, rkey: event.commit.rkey }, 'Error scoring activity (record still visible as pending)')
    }
  })

  jetstream.on('open', () => {
    logger.info('Jetstream connected')
  })

  jetstream.on('close', () => {
    logger.info('Jetstream disconnected')
  })

  jetstream.on('error', (err: Error) => {
    logger.error({ err }, 'Jetstream error')
  })
}
