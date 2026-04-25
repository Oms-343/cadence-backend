import { asStringArray, clamp, normalise, titleCase, uniqueStrings } from './utils.js'

const rxTerms = ['rx', 'prescription', 'adapalene', 'tretinoin', 'hydroquinone', 'finasteride', 'dutasteride', 'spironolactone']
const clinicalTerms = [...rxTerms, 'minoxidil', 'ketoconazole 2']
const supplementTerms = ['supplement', 'capsule', 'tablet', 'gummy', 'biotin', 'omega', 'collagen', 'vitamin', 'zinc', 'iron', 'folate', 'b12', 'fish oil', 'multivitamin']
const pregnancyUnsafeTerms = ['retinol', 'retinoid', 'adapalene', 'tretinoin', 'hydroquinone', 'minoxidil', 'finasteride', 'dutasteride', 'spironolactone']

const formatTerms = [
  ['sunscreen', 'Sunscreen'],
  ['spf', 'Sunscreen'],
  ['cleanser', 'Cleanser'],
  ['face wash', 'Face wash'],
  ['serum', 'Serum'],
  ['moisturizer', 'Moisturiser'],
  ['moisturiser', 'Moisturiser'],
  ['cream', 'Cream'],
  ['shampoo', 'Shampoo'],
  ['conditioner', 'Conditioner'],
  ['mask', 'Treatment mask'],
  ['capsule', 'Supplement'],
  ['tablet', 'Supplement'],
  ['gummy', 'Supplement'],
  ['oil', 'Oil'],
]

const trustedSources = ['nykaa', 'amazon', '1mg', 'tata 1mg', 'pharmeasy', 'apollo', 'netmeds', 'healthkart', 'flipkart', 'maccaron', 'foxy']

function textForResult(result) {
  return [result.title, result.name, result.snippet, result.summary, result.source, result.price, result.delivery, ...(result.extensions ?? [])].filter(Boolean).join(' ')
}

function classifyCategory(result, query) {
  const text = normalise(`${textForResult(result)} ${query}`)
  if (clinicalTerms.some((term) => text.includes(normalise(term)))) return 'clinical'
  if (supplementTerms.some((term) => text.includes(normalise(term)))) return 'nutraceutical'
  return 'otc'
}

function inferFormat(result, query) {
  const text = normalise(`${textForResult(result)} ${query}`)
  const match = formatTerms.find(([term]) => text.includes(term))
  if (match) return match[1]
  return classifyCategory(result, query) === 'nutraceutical' ? 'Supplement' : 'Product'
}

function extractMatchedIngredients(result, query, ingredientFocus) {
  const text = normalise(`${textForResult(result)} ${query}`)
  return asStringArray(ingredientFocus, 10).filter((ingredient) => text.includes(normalise(ingredient))).slice(0, 5)
}

function isPregnancyUnsafe(result) {
  const text = normalise(textForResult(result))
  return pregnancyUnsafeTerms.some((term) => text.includes(normalise(term)))
}

function sourceScore(source = '') {
  const sourceKey = normalise(source)
  if (!sourceKey) return 0
  return trustedSources.some((trusted) => sourceKey.includes(trusted)) ? 8 : 0
}

function budgetScore(product, assessment) {
  const budget = assessment.answers?.budget
  const ceilings = {
    budget_low: 500,
    budget_mid: 2000,
    budget_high: 5000,
    budget_premium: 15000,
  }
  const ceiling = ceilings[budget]
  if (!ceiling || !product.numericPrice || product.category === 'clinical') return 0
  if (product.numericPrice <= ceiling) return 6
  if (product.numericPrice <= ceiling * 1.35) return -4
  return -12
}

function matchAny(text, terms) {
  const key = normalise(text)
  return terms.filter((term) => {
    const termKey = normalise(term)
    return termKey && (key.includes(termKey) || termKey.includes(key))
  })
}

function scoreProduct(product, protocol, assessment, query) {
  const signals = protocol.productSignals ?? {}
  const ingredients = asStringArray(signals.ingredientFocus, 10)
  const categories = asStringArray(signals.productCategories, 8)
  const haystack = `${product.name} ${product.summary} ${product.source} ${query}`
  const ingredientMatches = matchAny(haystack, ingredients)
  const categoryMatches = matchAny(haystack, categories)
  const primary = assessment.answers?.primary
  const concernHint = primary ? matchAny(haystack, [primary, titleCase(primary), concernText(primary)]) : []

  let score = 45
  score += ingredientMatches.length * 9
  score += categoryMatches.length * 7
  score += concernHint.length * 5
  score += sourceScore(product.source)
  score += budgetScore(product, assessment)
  score += product.rating ? Math.min(6, Number(product.rating)) : 0
  score += product.reviews ? Math.min(6, Math.log10(Number(product.reviews) + 1) * 2.2) : 0

  if (protocol.isHair && normalise(haystack).includes('hair')) score += 7
  if (!protocol.isHair && ['skin', 'face', 'spf', 'serum', 'cleanser'].some((term) => normalise(haystack).includes(term))) score += 5

  return {
    score: clamp(Math.round(score), 45, 98),
    ingredientMatches,
    categoryMatches,
  }
}

function concernText(primary = '') {
  const map = {
    acne: 'acne breakouts pimples oil control',
    pigmentation: 'pigmentation dark spots melasma',
    antiaging: 'anti ageing wrinkles fine lines',
    dullness: 'glow radiance dull skin',
    hairloss: 'hair growth hair fall thinning',
    hairhealth: 'dandruff scalp repair hair health',
    rosacea: 'redness rosacea sensitive',
    sensitivity: 'sensitive barrier repair',
    scars: 'acne scars texture',
  }
  return map[primary] ?? primary
}

function buildWhy(product, matches, protocol) {
  const signals = uniqueStrings([...matches.ingredientMatches, ...matches.categoryMatches], 4)

  if (signals.length) {
    return `Ranked from live Google Shopping results because it matches ${signals.join(', ')} from the generated protocol.`
  }

  const primary = protocol.primaryLabel ? ` for ${protocol.primaryLabel}` : ''
  return `Ranked from live Google Shopping results as a relevant ${product.format.toLowerCase()}${primary}.`
}

function buildSafetyNote(product) {
  if (product.category === 'clinical') return 'Clinical/Rx-style match. Use only with clinician review and label directions.'
  if (isPregnancyUnsafe(product)) return 'This may be unsuitable during pregnancy or nursing. Confirm before use.'
  return undefined
}

export function normalizeShoppingResults(results, { query, protocol = {}, assessment = {} }) {
  return results
    .filter((result) => result && typeof result.title === 'string' && result.title.trim())
    .map((result, index) => {
      const category = classifyCategory(result, query)
      const format = inferFormat(result, query)
      const product = {
        id: String(result.product_id ?? `${normalise(result.title)}-${normalise(result.source)}-${index}`),
        name: result.title.trim(),
        category,
        format,
        price: result.price ?? 'Price not listed',
        numericPrice: Number(result.extracted_price) || undefined,
        source: result.source ?? 'Google Shopping',
        image: result.thumbnail ?? result.serpapi_thumbnail,
        summary: result.snippet ?? `Live ${format.toLowerCase()} result from ${result.source ?? 'Google Shopping'}.`,
        delivery: result.delivery,
        rating: Number(result.rating) || undefined,
        reviews: Number(result.reviews) || undefined,
        keyIngredients: extractMatchedIngredients(result, query, protocol.productSignals?.ingredientFocus),
        links: [
          {
            label: result.source ?? 'View product',
            url: result.product_link ?? result.link ?? result.serpapi_product_api,
          },
        ].filter((link) => link.url),
        prescriptionRequired: category === 'clinical' || rxTerms.some((term) => normalise(textForResult(result)).includes(normalise(term))),
      }
      const matches = scoreProduct(product, protocol, assessment, query)

      return {
        ...product,
        why: buildWhy(product, matches, protocol),
        howToUse: product.prescriptionRequired ? 'Use only after clinician review. Follow the prescribed label directions.' : 'Use according to label directions and introduce one new product at a time.',
        matchScore: matches.score,
        safetyNote: buildSafetyNote(product),
      }
    })
}

export function dedupeProducts(products) {
  const seen = new Set()
  const list = []

  for (const product of products) {
    const key = product.id || `${normalise(product.name)}-${normalise(product.source)}`
    if (seen.has(key)) continue
    seen.add(key)
    list.push(product)
  }

  return list
}

export function filterUnsafeProducts(products, assessment = {}) {
  const isPregnant = assessment.answers?.hormones === 'pregnant'
  if (!isPregnant) return products
  return products.filter((product) => !isPregnancyUnsafe(product))
}
