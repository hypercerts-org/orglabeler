import 'dotenv/config'
import fs from 'node:fs'
import { HOST, LABELER_PORT, METRICS_PORT, CURSOR_UPDATE_INTERVAL, CURSOR_PATH } from '../lib/config'
import { labelerServer } from './server'
import { startJetstreamSubscription } from './jetstream'
import { startMetricsServer } from './metrics'
import logger from './logger'

const CURSOR_FILE = CURSOR_PATH

// 1. Read cursor from cursor.txt (or create at Date.now() * 1000)
function readCursor(): number {
  try {
    const raw = fs.readFileSync(CURSOR_FILE, 'utf-8').trim()
    const parsed = parseInt(raw, 10)
    if (!isNaN(parsed)) return parsed
  } catch {
    // file doesn't exist or is invalid
  }
  return Date.now() * 1000
}

function writeCursor(cursor: number): void {
  try {
    fs.writeFileSync(CURSOR_FILE, String(cursor), 'utf-8')
  } catch (err) {
    logger.error({ err }, 'Failed to write cursor')
  }
}

async function main() {
  const cursor = readCursor()
  logger.info({ cursor }, 'Starting labeler process')

  // 2. Start LabelerServer on LABELER_PORT + HOST
  await new Promise<void>((resolve, reject) => {
    labelerServer.start({ port: LABELER_PORT, host: HOST }, (err, address) => {
      if (err) {
        reject(err)
        return
      }
      logger.info({ address }, 'LabelerServer started')
      resolve()
    })
  })

  // 3. Start metrics server on METRICS_PORT
  startMetricsServer(METRICS_PORT)
  logger.info({ port: METRICS_PORT }, 'Metrics server started')

  // 4. Start Jetstream subscription with cursor
  const subscription = startJetstreamSubscription(cursor)
  logger.info('Jetstream subscription started')

  // 5. Set interval to persist cursor to cursor.txt every CURSOR_UPDATE_INTERVAL
  const cursorInterval = setInterval(() => {
    const current = subscription.getCursor()
    if (current !== undefined) {
      writeCursor(current)
      logger.debug({ cursor: current }, 'Cursor persisted')
    }
  }, CURSOR_UPDATE_INTERVAL)

  // 6. Handle SIGINT/SIGTERM: save cursor, close subscription, stop servers
  async function shutdown(signal: string) {
    logger.info({ signal }, 'Shutting down...')
    clearInterval(cursorInterval)

    const current = subscription.getCursor()
    if (current !== undefined) {
      writeCursor(current)
    }

    subscription.dispose()

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
