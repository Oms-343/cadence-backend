import { config } from './config.js'
import { HttpError } from './errors.js'
import { dedupeProducts, filterUnsafeProducts, normalizeShoppingResults } from './productNormalizer.js'
import { buildShoppingQueries } from './queryBuilder.js'
import { searchGoogleShopping } from './serpApiClient.js'
import { clamp } from './utils.js'

function parseOptions(options = {}) {
  return {
    maxQueries: clamp(Number(options.maxQueries) || config.serpApi.maxQueries, 1, 8),
    resultsPerQuery: clamp(Number(options.resultsPerQuery) || config.serpApi.resultsPerQuery, 1, 20),
    location: typeof options.location === 'string' && options.location.trim() ? options.location.trim() : undefined,
    gl: typeof options.gl === 'string' && options.gl.trim() ? options.gl.trim() : undefined,
    hl: typeof options.hl === 'string' && options.hl.trim() ? options.hl.trim() : undefined,
  }
}

export async function getRawShoppingSearch(query, options = {}) {
  const cleanQuery = String(query ?? '').trim()
  if (!cleanQuery) throw new HttpError(400, 'Query parameter q is required.')

  const payload = await searchGoogleShopping(cleanQuery, options)
  return {
    query: cleanQuery,
    searchMetadata: payload.search_metadata,
    count: payload.shopping_results?.length ?? 0,
    results: payload.shopping_results ?? [],
  }
}

export async function buildLiveProductRecommendations({ protocol = {}, assessment = {}, options = {} }) {
  if (!protocol.productSignals) {
    throw new HttpError(400, 'protocol.productSignals is required.')
  }

  const parsedOptions = parseOptions(options)
  const queries = buildShoppingQueries({
    protocol,
    assessment,
    maxQueries: parsedOptions.maxQueries,
  })

  const searches = await Promise.all(
    queries.map(async (query) => {
      const payload = await searchGoogleShopping(query, {
        location: parsedOptions.location,
        gl: parsedOptions.gl,
        hl: parsedOptions.hl,
      })
      return {
        query,
        results: (payload.shopping_results ?? []).slice(0, parsedOptions.resultsPerQuery),
      }
    }),
  )

  const normalizedProducts = searches.flatMap((search) =>
    normalizeShoppingResults(search.results, {
      query: search.query,
      protocol,
      assessment,
    }),
  )

  const products = filterUnsafeProducts(dedupeProducts(normalizedProducts), assessment)
    .sort((first, second) => second.matchScore - first.matchScore)
    .slice(0, 12)

  return {
    source: 'serpapi_google_shopping',
    generatedAt: new Date().toISOString(),
    queries,
    count: products.length,
    products,
  }
}
