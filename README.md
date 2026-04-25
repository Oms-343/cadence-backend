# Cadence Backend

Small Express backend for testing SerpApi-powered product recommendations and live pincode-based environment lookup.

## Setup

```bash
cd cadence-backend
npm install
copy .env.example .env
```

Add your SerpApi key to `.env`:

```env
SERPAPI_API_KEY=your_key_here
```

Start the server:

```bash
npm run dev
```

Default URL:

```text
http://localhost:8787
```

## Routes

### Health

```bash
curl http://localhost:8787/health
```

### Raw Shopping Search

```bash
curl "http://localhost:8787/api/shopping-search?q=niacinamide%20serum%20oily%20skin%20India"
```

### Environment Lookup

```bash
curl "http://localhost:8787/api/environment?pincode=600001"
```

This route uses free, no-key sources:

- `pincodesinfo.in` for Indian pincode coordinates and location metadata, with `api.zippopotam.us` as fallback.
- Open-Meteo Air Quality for live US AQI, PM2.5, PM10, and forecast UV index.
- Open-Meteo Forecast for current relative humidity.

### Product Recommendations

```bash
curl -X POST http://localhost:8787/api/product-recommendations ^
  -H "Content-Type: application/json" ^
  -d "{\"protocol\":{\"isHair\":false,\"primaryLabel\":\"Acne & Breakouts\",\"productSignals\":{\"ingredientFocus\":[\"Salicylic Acid\",\"Niacinamide\",\"SPF 50\",\"Barrier support\"],\"productCategories\":[\"oil-control cleanser\",\"barrier moisturiser\",\"broad-spectrum sunscreen\"]}},\"assessment\":{\"answers\":{\"primary\":\"acne\",\"skinType\":\"oily\",\"pores\":\"large_pores\",\"budget\":\"budget_mid\"},\"chips\":{\"secondaryChips\":[\"pigmentation\"]}}}"
```

## Frontend Contract

`POST /api/product-recommendations` returns:

```json
{
  "source": "serpapi_google_shopping",
  "generatedAt": "2026-04-24T10:30:00.000Z",
  "queries": ["salicylic acid oil-control cleanser India"],
  "count": 8,
  "products": []
}
```

Each product is normalized for the Cadence card UI:

```json
{
  "id": "google-product-id-or-derived-id",
  "name": "Product title",
  "category": "otc",
  "format": "Serum",
  "price": "Rs. 599",
  "source": "Nykaa",
  "image": "https://...",
  "summary": "Matched from live Google Shopping results.",
  "why": "Why this product ranked for the protocol.",
  "howToUse": "Use according to label directions...",
  "matchScore": 91,
  "keyIngredients": ["Niacinamide"],
  "links": [{ "label": "Nykaa", "url": "https://..." }],
  "rating": 4.3,
  "reviews": 128
}
```

## Notes

- This is still a testing backend, not medical decision infrastructure.
- SerpApi finds live shopping candidates; Cadence still filters, classifies, and ranks them.
- Rx-like products are marked as clinical and should stay clinician-review only.

## Deploy To Render

Render is the simplest deployment target for this Express backend.

### Option A: Manual Web Service

1. Push this repository to GitHub.
2. In Render, create a new **Web Service**.
3. Select the repository.
4. Use these settings:

```text
Root Directory: cadence-backend
Runtime: Node
Build Command: npm ci
Start Command: npm start
Health Check Path: /health
```

5. Add environment variables:

```env
HOST=0.0.0.0
SERPAPI_API_KEY=your_serpapi_key_here
CORS_ORIGINS=https://your-frontend-domain.com,http://localhost:5173,http://localhost:5174
SERPAPI_LOCATION=India
SERPAPI_GOOGLE_DOMAIN=google.co.in
SERPAPI_GL=in
SERPAPI_HL=en
SERPAPI_MAX_QUERIES=5
SERPAPI_RESULTS_PER_QUERY=10
SERPAPI_TIMEOUT_MS=18000
ENVIRONMENT_API_TIMEOUT_MS=8000
```

Do not manually set `PORT` on Render unless you have a specific reason. Render provides it automatically.

### Option B: Blueprint Reference

`render.yaml` is included in this folder with the same production settings. If you use Render Blueprints from a monorepo, keep the service pointed at the `cadence-backend` folder.

### After Deployment

Check health:

```bash
curl https://your-render-service.onrender.com/health
```

Then update the frontend environment:

```env
VITE_CADENCE_BACKEND_URL=https://your-render-service.onrender.com
```
