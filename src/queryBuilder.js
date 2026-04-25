import { asStringArray, normalise, uniqueStrings } from './utils.js'

const concernWords = {
  acne: 'acne oily skin',
  pigmentation: 'pigmentation dark spots',
  antiaging: 'anti ageing fine lines',
  dullness: 'glow dull skin',
  hairloss: 'hair growth hair fall',
  hairhealth: 'dandruff scalp hair repair',
  rosacea: 'redness sensitive skin',
  sensitivity: 'sensitive skin barrier repair',
  scars: 'acne scars texture',
}

const highIntentSuffixes = ['India', 'buy online India']

function getProductSignals(protocol = {}) {
  const productSignals = protocol.productSignals ?? {}

  return {
    ingredients: asStringArray(productSignals.ingredientFocus, 10),
    categories: asStringArray(productSignals.productCategories, 8),
  }
}

function compactQuery(...parts) {
  return uniqueStrings(parts.filter(Boolean).join(' ').split(/\s+/), 16).join(' ')
}

function ingredientCategoryQueries(ingredients, categories, primary) {
  const queries = []
  const concern = concernWords[primary] ?? ''
  const usefulIngredients = ingredients.slice(0, 6)
  const usefulCategories = categories.slice(0, 5)

  for (const category of usefulCategories) {
    const bestIngredient = usefulIngredients.find((ingredient) => {
      const ingredientKey = normalise(ingredient)
      const categoryKey = normalise(category)
      return !categoryKey.includes(ingredientKey) && !ingredientKey.includes(categoryKey)
    })

    queries.push(compactQuery(bestIngredient, category, concern, highIntentSuffixes[0]))
  }

  for (const ingredient of usefulIngredients.slice(0, 3)) {
    queries.push(compactQuery(ingredient, concern, highIntentSuffixes[1]))
  }

  return queries
}

export function buildShoppingQueries({ protocol = {}, assessment = {}, maxQueries = 5 }) {
  const { ingredients, categories } = getProductSignals(protocol)
  const primary = assessment.answers?.primary
  const primaryLabel = protocol.primaryLabel || concernWords[primary] || primary || 'skin hair care'
  const queries = ingredientCategoryQueries(ingredients, categories, primary)

  if (!queries.length && ingredients.length) {
    queries.push(...ingredients.slice(0, 4).map((ingredient) => compactQuery(ingredient, primaryLabel, highIntentSuffixes[1])))
  }

  if (!queries.length) {
    queries.push(compactQuery(primaryLabel, protocol.isHair ? 'hair care products' : 'skincare products', highIntentSuffixes[1]))
  }

  return uniqueStrings(queries, maxQueries)
}
