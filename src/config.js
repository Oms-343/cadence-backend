import 'dotenv/config'

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function listFromEnv(name, fallback) {
  const raw = process.env[name]
  if (!raw) return fallback
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export const config = {
  host: process.env.HOST?.trim() || '0.0.0.0',
  port: numberFromEnv('PORT', 8787),
  serpApiKey: process.env.SERPAPI_API_KEY?.trim() ?? '',
  corsOrigins: listFromEnv('CORS_ORIGINS', [
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://localhost:5173',
    'http://localhost:5174',
  ]),
  serpApi: {
    endpoint: 'https://serpapi.com/search.json',
    location: process.env.SERPAPI_LOCATION?.trim() || 'India',
    googleDomain: process.env.SERPAPI_GOOGLE_DOMAIN?.trim() || 'google.co.in',
    gl: process.env.SERPAPI_GL?.trim() || 'in',
    hl: process.env.SERPAPI_HL?.trim() || 'en',
    maxQueries: numberFromEnv('SERPAPI_MAX_QUERIES', 5),
    resultsPerQuery: numberFromEnv('SERPAPI_RESULTS_PER_QUERY', 10),
    timeoutMs: numberFromEnv('SERPAPI_TIMEOUT_MS', 18000),
  },
  environmentApi: {
    timeoutMs: numberFromEnv('ENVIRONMENT_API_TIMEOUT_MS', 8000),
  },
}
