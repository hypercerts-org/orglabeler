import express from 'express'
import { collectDefaultMetrics, Gauge, Histogram, register } from 'prom-client'
import { getRecomputeJobCounts, getUrlCheckCounts } from '../lib/db'
import logger from './logger'

collectDefaultMetrics()

const recomputeJobsGauge = new Gauge({
  name: 'orglabeler_recompute_jobs',
  help: 'Durable recompute jobs grouped by status',
  labelNames: ['status'],
})

const tapHandlerDuration = new Histogram({
  name: 'orglabeler_tap_handler_duration_ms',
  help: 'Tap handler wall-clock duration in milliseconds by collection and action',
  labelNames: ['collection', 'action'],
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
})

const urlChecksGauge = new Gauge({
  name: 'orglabeler_url_checks',
  help: 'URL enrichment cache rows grouped by status',
  labelNames: ['status'],
})

/** Records how long the Tap handler took before the event could be acknowledged. */
export function observeTapHandlerDuration(collection: string, action: string, durationMs: number): void {
  tapHandlerDuration.observe({ collection, action }, durationMs)
}

function updateRecomputeJobMetrics(): void {
  const counts = getRecomputeJobCounts()
  for (const [status, count] of Object.entries(counts)) {
    recomputeJobsGauge.set({ status }, count)
  }
}

function updateUrlCheckMetrics(): void {
  const counts = getUrlCheckCounts()
  for (const [status, count] of Object.entries(counts)) {
    urlChecksGauge.set({ status }, count)
  }
}

export function startMetricsServer(port: number): ReturnType<typeof express> {
  const app = express()

  app.get('/metrics', async (_req, res) => {
    try {
      updateRecomputeJobMetrics()
      updateUrlCheckMetrics()
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
