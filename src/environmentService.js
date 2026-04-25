import { config } from './config.js'
import { HttpError } from './errors.js'

function validatePincode(pincode) {
  const clean = String(pincode ?? '').trim()
  if (!/^[0-9]{6}$/.test(clean)) {
    throw new HttpError(400, 'Please enter a valid 6-digit pincode.')
  }

  return clean
}

async function fetchJson(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.environmentApi.timeoutMs)

  try {
    const response = await fetch(url, { signal: controller.signal })
    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new HttpError(response.status, `Environment source returned HTTP ${response.status}.`, { url })
    }

    return payload
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new HttpError(504, 'Environment source timed out.', { url })
    }

    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function cleanString(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function titleCase(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
}

function numberValue(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function round(value) {
  return Number.isFinite(value) ? Math.round(Number(value)) : 0
}

function isTransientSourceError(error) {
  return error?.status === 429 || error?.status === 504 || error?.status >= 500
}

function stripPostOfficeSuffix(value) {
  return cleanString(value)
    .replace(/\s+(B\.?O\.?|S\.?O\.?|H\.?O\.?|G\.?P\.?O\.?|NDSO|NSH)$/i, '')
    .replace(/\s*\(([^)]+)\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function preferredPostOffice(results = []) {
  return [...results]
    .filter((result) => numberValue(result?.latitude) !== undefined && numberValue(result?.longitude) !== undefined)
    .sort((a, b) => {
      const aDelivery = cleanString(a.delivery_status).toLowerCase() === 'delivery' ? 0 : 1
      const bDelivery = cleanString(b.delivery_status).toLowerCase() === 'delivery' ? 0 : 1
      const aOffice = cleanString(a.office_type).toLowerCase() === 'ho' ? 0 : 1
      const bOffice = cleanString(b.office_type).toLowerCase() === 'ho' ? 0 : 1
      return aDelivery - bDelivery || aOffice - bOffice
    })[0]
}

async function lookupPincodesInfo(pincode) {
  const payload = await fetchJson(`https://pincodesinfo.in/api/pincode/${encodeURIComponent(pincode)}`)
  const postOffice = preferredPostOffice(payload?.results)

  if (!payload?.success || !postOffice) {
    throw new HttpError(404, 'Could not find this pincode in the Indian PIN directory.')
  }

  const city = titleCase(postOffice.district || postOffice.taluk || stripPostOfficeSuffix(postOffice.office_name))
  const state = titleCase(postOffice.state)

  return {
    city: city || stripPostOfficeSuffix(postOffice.office_name) || `Pincode ${pincode}`,
    state,
    latitude: Number(postOffice.latitude),
    longitude: Number(postOffice.longitude),
    source: 'pincodesinfo',
  }
}

async function lookupZippopotam(pincode) {
  const payload = await fetchJson(`https://api.zippopotam.us/IN/${encodeURIComponent(pincode)}`)
  const place = payload?.places?.find((candidate) => numberValue(candidate?.latitude) !== undefined && numberValue(candidate?.longitude) !== undefined)

  if (!place) {
    throw new HttpError(404, 'Could not find this pincode in the fallback PIN directory.')
  }

  return {
    city: titleCase(place['place name']) || `Pincode ${pincode}`,
    state: titleCase(place.state),
    latitude: Number(place.latitude),
    longitude: Number(place.longitude),
    source: 'zippopotam',
  }
}

function preferredPostalOffice(results = []) {
  return [...results]
    .filter(Boolean)
    .sort((a, b) => {
      const aDelivery = cleanString(a.DeliveryStatus).toLowerCase() === 'delivery' ? 0 : 1
      const bDelivery = cleanString(b.DeliveryStatus).toLowerCase() === 'delivery' ? 0 : 1
      const aHeadOffice = cleanString(a.BranchType).toLowerCase().includes('head') ? 0 : 1
      const bHeadOffice = cleanString(b.BranchType).toLowerCase().includes('head') ? 0 : 1
      return aDelivery - bDelivery || aHeadOffice - bHeadOffice
    })[0]
}

async function geocodeIndianLocation({ city, state, pincode }) {
  const query = cleanString(city || state || pincode)
  if (!query) {
    throw new HttpError(404, 'Could not geocode this pincode.')
  }

  const url = new URL('https://geocoding-api.open-meteo.com/v1/search')
  url.search = new URLSearchParams({
    name: query,
    count: '10',
    language: 'en',
    format: 'json',
  }).toString()

  const payload = await fetchJson(url.toString())
  const stateName = titleCase(state)
  const candidates = Array.isArray(payload?.results) ? payload.results : []
  const match = candidates
    .filter((candidate) => cleanString(candidate?.country_code).toUpperCase() === 'IN')
    .filter((candidate) => !stateName || titleCase(candidate?.admin1) === stateName)
    .find((candidate) => numberValue(candidate?.latitude) !== undefined && numberValue(candidate?.longitude) !== undefined)

  if (!match) {
    throw new HttpError(404, 'Could not geocode this pincode.')
  }

  return {
    city: titleCase(city) || titleCase(match.name) || `Pincode ${pincode}`,
    state: stateName || titleCase(match.admin1),
    latitude: Number(match.latitude),
    longitude: Number(match.longitude),
  }
}

async function lookupPostalPincode(pincode) {
  const payload = await fetchJson(`https://api.postalpincode.in/pincode/${encodeURIComponent(pincode)}`)
  const group = Array.isArray(payload) ? payload.find((entry) => cleanString(entry?.Status).toLowerCase() === 'success') : undefined
  const postOffice = preferredPostalOffice(group?.PostOffice)

  if (!postOffice) {
    throw new HttpError(404, 'Could not find this pincode in the India Post directory.')
  }

  const city = titleCase(postOffice.District || postOffice.Block || postOffice.Name)
  const state = titleCase(postOffice.State)
  const location = await geocodeIndianLocation({ city, state, pincode })

  return {
    ...location,
    source: 'postalpincode:open-meteo-geocode',
  }
}

async function lookupPincodeLocation(pincode) {
  try {
    return await lookupPincodesInfo(pincode)
  } catch (error) {
    if (error.status && !isTransientSourceError(error) && error.status !== 404) throw error
  }

  try {
    return await lookupZippopotam(pincode)
  } catch (error) {
    if (error.status && !isTransientSourceError(error) && error.status !== 404) throw error
    return lookupPostalPincode(pincode)
  }
}

function aqiCategory(aqi) {
  if (aqi <= 50) return 'Good'
  if (aqi <= 100) return 'Moderate'
  if (aqi <= 200) return 'Poor'
  if (aqi <= 300) return 'Very Poor'
  return 'Hazardous'
}

function pollutionLevel(aqi) {
  if (aqi > 150) return 'high_pol'
  if (aqi > 100) return 'moderate_pol'
  return 'low_pol'
}

function maxUvIndex(values) {
  if (!Array.isArray(values)) return 0

  return values.reduce((highest, value) => {
    const uv = numberValue(value)
    return uv === undefined ? highest : Math.max(highest, uv)
  }, 0)
}

function uvLevel(uvIndex) {
  if (uvIndex >= 11) return 'extreme_uv'
  if (uvIndex >= 8) return 'high_uv'
  if (uvIndex >= 5) return 'moderate_uv'
  return 'low_uv'
}

function humidityLevel(humidity) {
  if (!Number.isFinite(humidity)) return 'moderate'
  if (humidity >= 70) return 'high'
  if (humidity <= 40) return 'low'
  return 'moderate'
}

function climateType({ elevation, humidity, latitude, temperature }) {
  if ((elevation ?? 0) >= 1500 || (temperature ?? 24) <= 12) return 'cold_dry'
  if ((humidity ?? 55) <= 45 && (temperature ?? 28) >= 28) return 'arid_dry'
  if (Math.abs(latitude) <= 23.5 && (humidity ?? 55) >= 60 && (temperature ?? 24) >= 22) return 'tropical_humid'
  if ((humidity ?? 55) >= 68 && (temperature ?? 24) >= 24) return 'tropical_humid'
  return 'temperate'
}

function cityType({ elevation, humidity }) {
  if ((elevation ?? 0) >= 1500) return 'hill'
  if ((humidity ?? 0) >= 70) return 'coastal'
  return 'metro'
}

function buildNote({ aqi, category, humidity, uvIndex }) {
  const uvCopy = {
    low_uv: 'low UV exposure',
    moderate_uv: 'moderate UV exposure',
    high_uv: 'high UV exposure',
    extreme_uv: 'very high UV exposure',
  }
  const humidityCopy = humidity === 'high' ? 'high humidity' : humidity === 'low' ? 'dry ambient air' : 'moderate humidity'

  return `Live AQI is ${aqi} (${category}) with ${uvCopy[uvIndex] ?? 'UV exposure'} and ${humidityCopy}. Keep SPF, antioxidant support, and barrier care aligned to daily exposure.`
}

async function fetchOpenMeteoEnvironment(location) {
  const latitude = String(location.latitude)
  const longitude = String(location.longitude)
  const airUrl = new URL('https://air-quality-api.open-meteo.com/v1/air-quality')
  airUrl.search = new URLSearchParams({
    latitude,
    longitude,
    current: 'us_aqi,pm10,pm2_5',
    hourly: 'uv_index',
    forecast_days: '1',
    timezone: 'auto',
  }).toString()

  const weatherUrl = new URL('https://api.open-meteo.com/v1/forecast')
  weatherUrl.search = new URLSearchParams({
    latitude,
    longitude,
    current: 'relative_humidity_2m,temperature_2m',
    forecast_days: '1',
    timezone: 'auto',
  }).toString()

  const air = await fetchJson(airUrl.toString())
  const weather = await fetchJson(weatherUrl.toString()).catch((error) => {
    if (isTransientSourceError(error)) return undefined
    throw error
  })

  const aqi = round(numberValue(air?.current?.us_aqi))
  const pm25 = round(numberValue(air?.current?.pm2_5))
  const pm10 = round(numberValue(air?.current?.pm10))
  const humidityValue = numberValue(weather?.current?.relative_humidity_2m)
  const temperature = numberValue(weather?.current?.temperature_2m)
  const elevation = numberValue(weather?.elevation) ?? numberValue(air?.elevation)
  const humidity = humidityLevel(humidityValue)
  const uvIndex = uvLevel(maxUvIndex(air?.hourly?.uv_index))
  const category = aqiCategory(aqi)

  return {
    cityType: cityType({ elevation, humidity: humidityValue }),
    climate: climateType({ elevation, humidity: humidityValue, latitude: location.latitude, temperature }),
    uvIndex,
    aqi,
    pm25,
    pm10,
    humidity,
    category,
    note: buildNote({ aqi, category, humidity, uvIndex }),
    pollution: pollutionLevel(aqi),
  }
}

export async function buildEnvironmentLookup(rawPincode) {
  const pincode = validatePincode(rawPincode)
  const location = await lookupPincodeLocation(pincode)
  const environment = await fetchOpenMeteoEnvironment(location)

  return {
    city: location.city,
    state: location.state,
    ...environment,
    waterHardness: 'unknown_water',
    waterQ: 'unknown_water',
    pincode,
    source: `live:${location.source}:open-meteo`,
  }
}
