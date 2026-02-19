import 'dotenv/config'
import fs from 'node:fs'
import { HOST, LABELER_PORT, METRICS_PORT, CURSOR_UPDATE_INTERVAL } from '../lib/config'
import { labelerServer } from './server'
import { createJetstream, setupHandlers } from './jetstream'
import { startMetricsServer } from './metrics'
import logger from './logger'

const CURSOR_FILE = 'cursor.txt'

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

  // 2. Create Jetstream with cursor
  const jetstream = createJetstream(cursor)

  // 3. Setup handlers
  setupHandlers(jetstream)

  // 4. Start LabelerServer on LABELER_PORT + HOST
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

  // 5. Start metrics server on METRICS_PORT
  startMetricsServer(METRICS_PORT)
  logger.info({ port: METRICS_PORT }, 'Metrics server started')

  // 6. Start Jetstream
  jetstream.start()
  logger.info('Jetstream started')

  // 7. Set interval to persist cursor to cursor.txt every CURSOR_UPDATE_INTERVAL
  const cursorInterval = setInterval(() => {
    if (jetstream.cursor !== undefined) {
      writeCursor(jetstream.cursor)
      logger.debug({ cursor: jetstream.cursor }, 'Cursor persisted')
    }
  }, CURSOR_UPDATE_INTERVAL)

  // 8. Handle SIGINT/SIGTERM: save cursor, close jetstream, stop servers
  async function shutdown(signal: string) {
    logger.info({ signal }, 'Shutting down...')
    clearInterval(cursorInterval)

    if (jetstream.cursor !== undefined) {
      writeCursor(jetstream.cursor)
    }

    jetstream.close()

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
