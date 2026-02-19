import 'dotenv/config'
import fs from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { HOST, LABELER_PORT, METRICS_PORT, TAP_URL, TAP_BIND, TAP_DB_PATH, ACTIVITY_COLLECTION } from '../lib/config'
import { labelerServer } from './server'
import { startTapConsumer } from './tap-consumer'
import { startMetricsServer } from './metrics'
import logger from './logger'

function spawnTap(): ChildProcess {
  const tapProcess = spawn('tap', ['run'], {
    env: {
      ...process.env,
      TAP_SIGNAL_COLLECTION: ACTIVITY_COLLECTION,
      TAP_COLLECTION_FILTERS: ACTIVITY_COLLECTION,
      TAP_DATABASE_URL: `sqlite://${TAP_DB_PATH}`,
      TAP_BIND: TAP_BIND,
      TAP_LOG_LEVEL: 'info',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  tapProcess.stdout?.on('data', (data: Buffer) => {
    logger.info({ source: 'tap' }, data.toString().trim())
  })
  tapProcess.stderr?.on('data', (data: Buffer) => {
    logger.error({ source: 'tap' }, data.toString().trim())
  })
  tapProcess.on('exit', (code) => {
    logger.warn({ code }, 'Tap process exited')
  })

  return tapProcess
}

async function waitForTap(url: string, maxAttempts = 30, intervalMs = 1000): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${url}/health`)
      if (res.ok) {
        logger.info('Tap is healthy')
        return
      }
    } catch {
      // tap not ready yet
    }
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error(`Tap did not become healthy after ${maxAttempts} attempts`)
}

async function main() {
  // Check for reset flag (useful for Railway where we cant access the volume directly)
  if (process.env.RESET_DB === 'true') {
    const { ACTIVITY_DB_PATH } = await import('../lib/config')
    const filesToDelete = [ACTIVITY_DB_PATH, TAP_DB_PATH, `${ACTIVITY_DB_PATH}-wal`, `${ACTIVITY_DB_PATH}-shm`, `${TAP_DB_PATH}-wal`, `${TAP_DB_PATH}-shm`]
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

  // 2. Start metrics server
  startMetricsServer(METRICS_PORT)
  logger.info({ port: METRICS_PORT }, 'Metrics server started')

  // 3. Spawn tap sidecar
  const tapProcess = spawnTap()
  logger.info('Tap process spawned, waiting for health...')

  // 4. Wait for tap to be ready
  await waitForTap(TAP_URL)

  // 5. Start tap consumer (replaces Jetstream subscription)
  const consumer = startTapConsumer()
  logger.info('Tap consumer started — receiving backfill + live events')

  // 6. Shutdown handler
  async function shutdown(signal: string) {
    logger.info({ signal }, 'Shutting down...')
    await consumer.destroy()
    tapProcess.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      labelerServer.close(() => resolve())
    })
    logger.info('Shutdown complete')
    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error in labeler process')
  process.exit(1)
})
