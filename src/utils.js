export function normalise(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function titleCase(value) {
  return String(value ?? '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function uniqueStrings(values, limit = values.length) {
  const seen = new Set()
  const list = []

  for (const value of values) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim()
    const key = normalise(text)
    if (!key || seen.has(key)) continue
    seen.add(key)
    list.push(text)
    if (list.length >= limit) break
  }

  return list
}

export function asStringArray(value, limit = 20) {
  if (!Array.isArray(value)) return []
  return uniqueStrings(value.filter((item) => typeof item === 'string'), limit)
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}
