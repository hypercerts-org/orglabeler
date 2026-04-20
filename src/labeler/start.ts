import 'dotenv/config'
import fs from 'node:fs'
import { HOST, LABELER_PORT, METRICS_PORT, TAP_URL, APP_DB_PATHS } from '../lib/config'
import { getPendingActivities, deleteActivity } from '../lib/db'
import { labelerServer, negateAllDIDLabels, applyQualityLabel } from './server'
import { startTapConsumer, backfillHfClassification, syncLabelsWithDb } from './tap-consumer'
import { setReclassifyCallback } from '../lib/hf-classifier'
import { startMetricsServer } from './metrics'
import logger from './logger'

// Fix 3 & 4: module-scope shuttingDown flag used by shutdown
let shuttingDown = false

async function waitForTap(url: string, maxAttempts = 30, intervalMs = 1000): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${url}/health`)
      // Any HTTP response (including 401 when TAP_ADMIN_PASSWORD is set)
      // means Tap is up and listening. Only network errors mean it isn't ready.
      if (res.status < 500) {
        logger.info({ status: res.status }, 'Tap is healthy')
        return
      }
    } catch {
      // tap not ready yet — connection refused or similar
    }
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error(`Tap did not become healthy after ${maxAttempts} attempts`)
}

async function main() {
  // Fix 4: declare consumer at outer scope so shutdown can access it
  // even if a signal arrives during startup
  let consumer: Awaited<ReturnType<typeof startTapConsumer>> | undefined

  // Fix 4: register shutdown handlers EARLY, before any async work
  async function shutdown(signal: string) {
    if (shuttingDown) return
    shuttingDown = true
    logger.info({ signal }, 'Shutting down...')
    await consumer?.destroy()
    await new Promise<void>((resolve) => {
      labelerServer.close(() => resolve())
    })
    logger.info('Shutdown complete')
    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  // Check for reset flag (useful for Railway where we cant access the volume directly)
  if (process.env.RESET_DB === 'true') {
    const filesToDelete = APP_DB_PATHS.flatMap(path => [path, `${path}-wal`, `${path}-shm`])
    for (const f of filesToDelete) {
      try {
        fs.unlinkSync(f)
        logger.warn({ file: f }, 'RESET_DB: deleted database file')
      } catch {
        // file may not exist, thats fine
      }
    }
    logger.warn('RESET_DB: databases cleared, starting fresh. Remove RESET_DB env var after restart.')
  }

  logger.info('Starting labeler process')

  // 1. Start LabelerServer
  await new Promise<void>((resolve, reject) => {
    labelerServer.start({ port: LABELER_PORT, host: HOST }, (err, address) => {
      if (err) { reject(err); return }
      logger.info({ address }, 'LabelerServer started')
      resolve()
    })
  })

  // Wire HF reclassification to also update ATProto labels
  setReclassifyCallback(applyQualityLabel)

  // 2. Start metrics server
  startMetricsServer(METRICS_PORT)
  logger.info({ port: METRICS_PORT }, 'Metrics server started')

  // 2b. Negate any stale DID-level labels from previous deployments
  // Fix 1: wrap in try/catch so a failure doesn't crash startup
  try {
    const negatedCount = await negateAllDIDLabels()
    if (negatedCount > 0) {
      logger.info({ count: negatedCount }, 'Negated stale DID-level labels')
    }
  } catch (err) {
    logger.error({ err }, 'Failed to negate stale DID-level labels — continuing startup')
  }

  // Fix 7: clean up stale pending records BEFORE starting tap consumer
  // so a backfill event can't re-score a record that we're about to delete
  const pendingRecords = getPendingActivities()
  if (pendingRecords.length > 0) {
    logger.warn({ count: pendingRecords.length }, 'Deleting stale pending records — they will be re-scored on next tap event')
    for (const record of pendingRecords) {
      deleteActivity(record.did, record.rkey)
    }
  }

  // 3. Wait for external Tap service
  logger.info('Waiting for external Tap health...')

  // 4. Wait for tap to be ready
  await waitForTap(TAP_URL)

  // 5. Start tap consumer (replaces Jetstream subscription)
  consumer = startTapConsumer()
  logger.info('Tap consumer started — receiving backfill + live events')
  backfillHfClassification()

  // One-time sync: fix any records where DB tier disagrees with ATProto label
  // (caused by pre-fix HF reclassifications that only updated the DB)
  syncLabelsWithDb().catch(err => {
    logger.warn({ err }, 'Label sync failed — will retry on next restart')
  })
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error in labeler process')
  process.exit(1)
})
