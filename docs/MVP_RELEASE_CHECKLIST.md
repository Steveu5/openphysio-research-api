# OpenPhysioAI MVP release checklist

This checklist defines the minimum release gate for Chat, Research, and Biblioteca. New feature work stays frozen until the current clinical tools, saved research, history, audit, and published Library resources are stable in production.

Research must remain an evidence-search and synthesis tool: **“Esto es lo que encontramos y analizamos en la literatura científica.”** It must not become a second clinical answer; patient-facing clinical interpretation belongs to Chat.

## 1. CI gate

Before production validation, confirm the current `main` commit is green in both repositories:

- [ ] Backend `npm test` passes with no failing tests.
- [ ] Backend ranking benchmark passes.
- [ ] Frontend unit/quality checks and production build pass.
- [ ] Frontend Playwright clinical-tools E2E passes on desktop Chrome and the configured mobile viewport.
- [ ] No release is cut from a commit older than the green `main` heads that were validated.

## 2. Backend deployment

- [ ] Configure every required runtime variable from `.env.example`.
- [ ] Set `ALLOWED_ORIGINS` to the canonical production frontend origin.
- [ ] Deploy the image built from the validated `main` commit.
- [ ] Confirm `GET /health` returns HTTP 200 and `status: ok`.
- [ ] Confirm `GET /health/ready` returns HTTP 200 and `status: ready`.
- [ ] Confirm `GET /research/version` returns the active algorithm and ranking versions.
- [ ] Run the authenticated production smoke test with a real subscribed test account:

```bash
SMOKE_API_ROOT="https://api.openphysiohub.com" \
SMOKE_ACCESS_TOKEN="<short-lived-test-user-token>" \
SMOKE_REQUIRE_AUTHENTICATED=true \
SMOKE_RUN_CLINICAL=true \
npm run smoke:production
```

The release smoke must verify the public runtime endpoints, authenticated Biblioteca access in Spanish and English, one live Research query, and one live Chat query. Never commit the smoke-test access token.

## 3. Biblioteca production audit

Run the Library asset audit with production Supabase service credentials from a secure operator environment:

```bash
npm run library:audit:production
```

- [ ] Every published `library_catalog` row has `validation_status=ready`, a valid slug, and a storage path.
- [ ] Every published manifest matches its catalog slug and storage path.
- [ ] Every language declared by the manifest has a non-empty integrated report, audio, and four infographics.
- [ ] Manifest file sizes and SHA-256 hashes match Storage when metadata is present.
- [ ] Published reports contain no `file://`, localhost, local-user paths, or blob-only asset references.
- [ ] Catalog DOIs, when present, have a valid DOI format.
- [ ] In the production UI, open at least one original-article DOI link and confirm the publisher/resolver page is reachable.
- [ ] Deep links to a valid guide open the exact guide; retired or invalid guide links show the unavailable-guide state rather than a blank page.

Use `npm run library:audit:production -- --json` for machine-readable output or `npm run library:audit:production -- --slug=<slug>` to re-audit one published guide after a correction.

## 4. Supabase and access

- [ ] A newly registered user receives a row in `profiles`.
- [ ] A test user has `subscription_status` set to `active` or `trialing`.
- [ ] `current_period_end`, when present, is in the future.
- [ ] Row-level security and service-role usage have been reviewed.
- [ ] No service-role or DeepSeek key is present in frontend code.
- [ ] Favorites persist after sign-out/sign-in and a failed remote favorite sync does not destroy the local state.

## 5. Core production journey

Use one real subscribed test account and complete the flow in the deployed frontend.

### Chat

1. Sign in and open Chat.
2. Ask a clinical question.
3. Confirm a structured clinical answer, visible sources, and follow-up questions appear.
4. Simulate or observe a recoverable API failure and confirm the original question is preserved and can be retried without duplication.

### Research

1. Open Research.
2. Search for `dolor lumbar crónico y ejercicio terapéutico`.
3. Confirm **Panorama de la evidencia** appears.
4. Confirm **Hallazgos científicos** synthesize the literature and do not present a second clinical prescription.
5. Confirm numeric citations point to the correct stable `source_index` even after sorting/filtering.
6. Confirm article cards retain Calidad, Coincidencia, Prioridad de lectura, and available PEDro/DOI/limitations details.
7. Confirm Consistencia/contradicciones/límites, Bibliografía priorizada, and the collapsible Metodología section render.
8. Save one article, open **Mi investigación**, move it to a collection, and add a note.
9. Open search history and **Auditoría**; confirm snapshot integrity, reproducibility, versions, and ranking movement render without error.

### Biblioteca

1. Open Biblioteca and confirm the published catalog loads.
2. Open one integrated report in Spanish and English.
3. Play an audio resource.
4. Open and download at least one infographic.
5. Open the original article/DOI when available.
6. Open a guide via an exact deep link from Chat or Research.

### Session and navigation

1. Refresh Chat, Research, Biblioteca, workspace, and audit routes directly.
2. Open a nonexistent application URL and confirm the 404 experience renders.
3. Sign out and confirm protected clinical-tool routes are no longer accessible.

## 6. Minimum failure checks

- [ ] Expired session shows a user-readable message and does not discard recoverable user input.
- [ ] User without an active subscription receives the subscription-required state.
- [ ] Missing profile receives the profile-not-found state.
- [ ] API unavailable produces a connection message instead of a blank page.
- [ ] AI-provider timeout produces the timeout/retry state instead of an endless loader.
- [ ] A Research search with zero results still has a coherent empty-evidence state and history behavior.
- [ ] Invalid Library slug or unavailable language/resource produces the explicit unavailable state.
- [ ] Refreshing protected application routes does not produce a hosting 404.

## 7. Device release pass

Run the complete production journey at least once on:

- [ ] Desktop Chrome.
- [ ] iPhone/Safari.
- [ ] Android/Chrome.

The Playwright desktop/mobile E2E remains the deterministic CI guard, but it does not replace this final deployed-device pass because its network responses are mocked.

## 8. Release decision

The MVP is considered releasable only when:

- backend tests and ranking benchmark are green;
- frontend quality/build and clinical-tools E2E are green;
- authenticated production smoke passes with `SMOKE_RUN_CLINICAL=true`;
- the full published Biblioteca asset audit reports zero failures;
- the core production journey passes on desktop, iPhone, and Android;
- there are no critical scientific-integrity, authentication, subscription, saving, history, audit, or Library-resource blockers.

Visual redesign, new tools, additional filters, larger Library expansion, commercial analytics, and payment-flow changes are separate blocks and must not be mixed into this stabilization release unless they prevent the existing product from functioning safely.
