# AI Investment Assistant

A stock analysis terminal that gives self-directed investors real buy/sell/hold signals backed by live technical indicators, macroeconomic data, and market breadth metrics.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/investment-app run dev` — run the frontend (port varies)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind + Recharts + Framer Motion
- API: Express 5
- Data: yahoo-finance2 (stock data), FRED API (macro data)
- Validation: Zod (`zod/v4`), Orval codegen from OpenAPI spec
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for all API contracts)
- `lib/api-client-react/src/generated/` — generated React Query hooks (do not hand-edit)
- `lib/api-zod/src/generated/` — generated Zod schemas for server-side validation
- `artifacts/api-server/src/lib/stockAnalysis.ts` — core technical analysis + yahoo-finance2 calls
- `artifacts/api-server/src/lib/fredMacro.ts` — FRED API macro data fetcher
- `artifacts/api-server/src/routes/analyze.ts` — POST /api/analyze route
- `artifacts/api-server/src/routes/market.ts` — GET /api/macro and GET /api/trending routes
- `artifacts/investment-app/src/` — React frontend

## Architecture decisions

- **Technical indicators are calculated manually** (RSI, EMA, MACD, SMA) instead of using the `technicalindicators` package, to avoid ESM/CJS interop issues with esbuild bundling.
- **yahoo-finance2 v4 requires instantiation**: `import YahooFinanceClass from "yahoo-finance2"; const yahooFinance = new (YahooFinanceClass as any)()` — the default export is a class, not a singleton.
- **In-memory cache** on `/api/macro` (30 min TTL) and `/api/trending` (5 min TTL) to avoid hammering Yahoo Finance and FRED on every page load.
- **FRED_API_KEY** is stored as a shared env var (not a secret) since it's a public rate-limiting key.
- Frontend chart uses Recharts with normalized price data (rebased to 100 at period start) for ticker vs S&P 500 comparison.

## Product

- **Terminal page (/)**: Enter any ticker symbol → get RSI, MACD, SMA50/SMA200 signals, support/resistance levels, fundamental data (P/E, Market Cap, EPS), normalized 6-month performance chart vs S&P 500, recent news, and a STRONG BUY / BUY / HOLD / SELL / STRONG SELL recommendation with composite score.
- **Market Macro page (/market)**: Live GDP, CPI, inflation YoY, unemployment, Fed Funds Rate from FRED; VIX, 10Y yield, yield curve, and market breadth (% of mega-caps above 50-day MA) from Yahoo Finance; trending tickers table.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- After any OpenAPI spec change, run codegen before touching routes or frontend code.
- yahoo-finance2 analysis calls take 3-8 seconds — the frontend shows an animated loading state while waiting.
- `pnpm run dev` at workspace root has no script by design — run artifacts individually or via workflows.
