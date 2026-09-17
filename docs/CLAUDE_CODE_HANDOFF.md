# OpenPhysioAI Research API — Claude Code handoff

This is the backend half of OpenPhysioAI. The separate Electronic Health Record product is out of scope.

## Canonical pair

- Frontend: `Steveu5/openphysio-frontend`
- Backend: `Steveu5/openphysio-research-api`

Production:

- Frontend: `https://openphysioaihub.com`
- API: `https://api.openphysiohub.com`
- Supabase: `HostingerBD` / `arxstzttwbeytgknxkoa`

## Current API surface

The README is the authoritative endpoint summary. Major responsibilities include:

- `POST /research/search`
- Research history and audit
- saved Research workspace
- Clinical Chat endpoints/services
- scientific retrieval, ranking and synthesis
- source/citation preservation

## Environment

Server-side variables include:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DEEPSEEK_API_KEY`
- `ALLOWED_ORIGINS`
- production tuning variables documented in `.env.example`

Never put server credentials in the frontend or Git.

## Validation

Before PR merge:

```bash
npm ci
npm test
npm run benchmark:ranking
```

After a production deployment, use the documented smoke check against `https://api.openphysiohub.com`.

## Coordination rule

When changing the Research/Chat response contract, inspect the frontend client and components before finalizing. If the frontend requires a change, coordinate both repositories rather than breaking one side.

## Supabase source-of-truth

Database/source-of-truth normalization is led from the private frontend repository because it already contains the primary `supabase/` project directory and may need to store audit notes about legacy remote functions. Do not create a competing Supabase project tree here unless there is a clear backend-specific migration that belongs here.

## First actions for Claude Code

1. Read this file and root `CLAUDE.md`.
2. Pull latest `main`.
3. Confirm the test suite is green before feature work.
4. Coordinate with the frontend handoff and Supabase inventory.
5. Preserve bilingual and citation behavior while continuing normal development.
