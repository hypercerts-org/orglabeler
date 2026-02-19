import express from 'express'
import { collectDefaultMetrics, register } from 'prom-client'

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

  app.listen(port)

  return app
}
