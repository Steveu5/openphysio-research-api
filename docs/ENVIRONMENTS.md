# Environments: development, test, production

This repository is public: never commit keys, URLs with tokens, or real data.

| Environment | How it is selected | Env file loaded | Supabase | DeepSeek |
|---|---|---|---|---|
| production | `NODE_ENV=production` (Dockerfile) or unset | `.env` / platform variables (unchanged) | production project | `DEEPSEEK_API_KEY` |
| development | `APP_ENV=development` or `NODE_ENV=development` | `.env.development.local` (if present, `.env` is not read) | local only | `DEEPSEEK_TEST_API_KEY` only |
| test | `node --test`, `APP_ENV=test` or `NODE_ENV=test` | `.env.test.local`, otherwise **nothing** (never `.env`) | local only | `DEEPSEEK_TEST_API_KEY` only |

## Guards (`src/config/environmentGuard.js`)
- Outside production, the production Supabase project is refused by URL **and** by key (`ref` claim of the JWT). The process stops with `[environment guard] …` before any query.
- `development` may opt in for a deliberate read-only check with `ALLOW_PRODUCTION_BACKEND=true`; `test` never can.
- Outside production `DEEPSEEK_API_KEY` is never read. Without `DEEPSEEK_TEST_API_KEY` no paid AI call happens; with it, at most `DEEPSEEK_TEST_MAX_CALLS` (default 20) per process.
- Unit tests use synthetic values and mocked `fetch`; they make no network calls to Supabase or DeepSeek.
- Operator tools under `tools/library-*` and `tools/audit-library-production.js` are production tools by design and are not run in tests.

## DeepSeek spending control (verified 2026-11-25 in the official docs)
- Billing is a **prepaid balance per account**; all keys of an account share it. When it is exhausted the API answers `402 Insufficient Balance`.
- There is **no per-key spending cap** and no monthly budget setting in the documented API. Concurrency limits are per account. `GET /user/balance` reports the balance; the Usage page shows usage per key.
- Therefore the real hard limit is: **a separate DeepSeek account for testing with a small top-up (e.g. USD 2–5) and no further top-ups**. A second key in the production account would share production's balance.

## Local Supabase
Started from `openphysio-frontend` with `npx supabase start` (Docker, no cost). Use the local URL and the keys it prints in `.env.development.local` / `.env.test.local`. Synthetic users only (`qa+1@example.test`).
