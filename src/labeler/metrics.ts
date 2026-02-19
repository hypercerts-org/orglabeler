import express from 'express'
import { collectDefaultMetrics, register } from 'prom-client'
import logger from './logger'

collectDefaultMetrics()

export function startMetricsServer(port: number): ReturnType<typeof express> {
  const app = express()

  app.get('/metrics', async (_req, res) => {
    try {
      res.set('Content-Type', register.contentType)
      res.end(await register.metrics())
    } catch (err) {
      res.status(500).end(String(err))
    }
  })

  // Fix 5: handle port conflicts gracefully — metrics are non-critical
  const server = app.listen(port)
  server.on('error', (err) => {
    logger.error({ err, port }, 'Metrics server failed to bind — continuing without metrics')
  })

  return app
}
