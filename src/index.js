'use strict'

const { createMozgServer, createMetricsServer, metricsSettings } = require('./server')
const { logger } = require('./telemetry')

const PORT = process.env.PORT || 4000

const server = createMozgServer()
const metricsServer = createMetricsServer()
const metrics = metricsSettings()

server.listen(PORT, () => {
  console.log('Mozg server is running')
  console.log(`  Web interface  →  http://localhost:${PORT}/`)
  console.log(`  GraphQL API    →  http://localhost:${PORT}/graphql`)
  console.log(`  Streaming API  →  http://localhost:${PORT}/stream`)
  console.log(`  Health check   →  http://localhost:${PORT}/healthz`)
  console.log(`  Demand         →  http://localhost:${PORT}/demand`)
  if (metrics.enabled && !metricsServer) console.log(`  Metrics        →  http://localhost:${PORT}/metrics`)
})

if (metricsServer) {
  metricsServer.listen(metrics.port, () => console.log(`  Metrics        →  http://localhost:${metrics.port}/metrics (separate port)`))
}

// Finish in-flight queries before exiting when the platform asks us to stop;
// federated queries can legitimately take a while ("slow by design"), so give
// them a generous grace period before forcing the issue.
const SHUTDOWN_GRACE_MS = Number(process.env.MOZG_SHUTDOWN_GRACE_MS) || 30_000
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    logger.info(`${signal} received — draining connections`)
    if (metricsServer) metricsServer.close()
    server.close(() => process.exit(0))
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections()
    setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref()
  })
}
