import { Jetstream } from '@skyware/jetstream'
import type { CommitCreateEvent } from '@skyware/jetstream'
import { FIREHOSE_URL, ACTIVITY_COLLECTION } from '../lib/config'
import { scoreActivity } from '../lib/scorer'
import { applyQualityLabel } from './server'
import { logActivity } from '../lib/db'
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
    try {
      const record = event.commit.record as unknown as ActivityRecord

      // Validate minimally: must have title and shortDescription and createdAt
      if (!record.title || !record.shortDescription || !record.createdAt) {
        logger.warn({ did: event.did, rkey: event.commit.rkey }, 'Skipping record: missing required fields')
        return
      }

      // Score the record
      const result = scoreActivity(record)

      // Apply label
      await applyQualityLabel(event.did, result.tier)

      // Log to activity DB
      logActivity({
        did: event.did,
        rkey: event.commit.rkey,
        uri: `at://${event.did}/${ACTIVITY_COLLECTION}/${event.commit.rkey}`,
        title: record.title,
        score: result.totalScore,
        tier: result.tier,
        breakdown: JSON.stringify(result.breakdown),
        testSignals: JSON.stringify(result.testSignals),
        labeledAt: new Date().toISOString(),
      })

      logger.info(
        { did: event.did, rkey: event.commit.rkey, score: result.totalScore, tier: result.tier },
        `Scored ${event.did} rkey=${event.commit.rkey}: ${result.totalScore}/100 → ${result.tier}`
      )
    } catch (err) {
      logger.error({ err, did: event.did, rkey: event.commit.rkey }, 'Error processing activity record')
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
