import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import morgan from 'morgan'
import { config } from './config.js'
import { buildEnvironmentLookup } from './environmentService.js'
import { asyncRoute, HttpError } from './errors.js'
import { buildLiveProductRecommendations, getRawShoppingSearch } from './recommendationService.js'

const app = express()

app.use(helmet({ crossOriginResourcePolicy: false }))
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin) || config.corsOrigins.includes('*')) {
        callback(null, true)
        return
      }
      callback(null, false)
    },
  }),
)
app.use(express.json({ limit: '1mb' }))
app.use(morgan('dev'))

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'cadence-backend',
    serpApiConfigured: Boolean(config.serpApiKey),
    environmentLookupConfigured: true,
    time: new Date().toISOString(),
  })
})

app.get(
  '/api/shopping-search',
  asyncRoute(async (req, res) => {
    const result = await getRawShoppingSearch(req.query.q, {
      location: req.query.location,
      gl: req.query.gl,
      hl: req.query.hl,
    })
    res.json(result)
  }),
)

app.get(
  '/api/environment',
  asyncRoute(async (req, res) => {
    const result = await buildEnvironmentLookup(req.query.pincode)
    res.json(result)
  }),
)

app.post(
  '/api/product-recommendations',
  asyncRoute(async (req, res) => {
    const result = await buildLiveProductRecommendations({
      protocol: req.body?.protocol,
      assessment: req.body?.assessment,
      options: req.body?.options,
    })
    res.json(result)
  }),
)

app.use((_req, _res, next) => {
  next(new HttpError(404, 'Route not found.'))
})

app.use((error, _req, res, _next) => {
  const status = error.status || 500
  const message = status === 500 ? 'Internal server error.' : error.message

  if (status >= 500) {
    console.error(error)
  }

  res.status(status).json({
    error: message,
    details: error.details,
  })
})

const server = app.listen(config.port, config.host, () => {
  const displayHost = config.host === '0.0.0.0' ? 'localhost' : config.host
  console.log(`Cadence backend listening on http://${displayHost}:${config.port}`)
})

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use. Stop the existing server or set a different PORT in cadence-backend/.env.`)
    process.exit(1)
  }

  throw error
})
