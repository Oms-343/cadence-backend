import { config } from './config.js'
import { HttpError } from './errors.js'

export async function searchGoogleShopping(query, options = {}) {
  if (!config.serpApiKey) {
    throw new HttpError(503, 'SERPAPI_API_KEY is missing. Add it to cadence-backend/.env before searching.')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? config.serpApi.timeoutMs)
  const params = new URLSearchParams({
    engine: 'google_shopping',
    q: query,
    api_key: config.serpApiKey,
    location: options.location ?? config.serpApi.location,
    google_domain: options.googleDomain ?? config.serpApi.googleDomain,
    gl: options.gl ?? config.serpApi.gl,
    hl: options.hl ?? config.serpApi.hl,
    device: 'desktop',
    output: 'json',
  })

  if (options.minPrice) params.set('min_price', String(options.minPrice))
  if (options.maxPrice) params.set('max_price', String(options.maxPrice))
  if (options.sortBy) params.set('sort_by', String(options.sortBy))

  try {
    const response = await fetch(`${config.serpApi.endpoint}?${params.toString()}`, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    })

    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new HttpError(response.status, 'SerpApi request failed.', payload)
    }

    if (payload.error) {
      throw new HttpError(502, payload.error, payload)
    }

    return payload
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new HttpError(504, `SerpApi timed out for query: ${query}`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
