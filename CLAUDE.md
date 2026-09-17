# Claude Code instructions — OpenPhysioAI clinical/research API

## Scope

This repository is the server-side Clinical Chat and Research API for **OpenPhysioAI**.

Do **not** modify or inspect the separate Electronic Health Record product. Do not touch `Steveu5/openphysio-hce`, CARF HCE repositories, the `physionodex` Supabase project, Nora, Telecare or HCE clinical records unless the user explicitly starts a separate HCE task.

## Related systems

- Frontend: `Steveu5/openphysio-frontend`
- This API: `Steveu5/openphysio-research-api`
- OpenPhysioAI Supabase: `HostingerBD`, ref `arxstzttwbeytgknxkoa`
- Production API: `https://api.openphysiohub.com`
- Production frontend: `https://openphysioaihub.com`

## Responsibilities

This API owns:

- Clinical Chat backend behavior
- scientific search orchestration
- literature retrieval and normalization
- ranking and evidence metadata
- Research synthesis
- Research history/audit/saved workspace endpoints
- server-side model/provider calls
- server-side Supabase access

Do not move server secrets or provider calls into the browser.

## Clinical and bilingual rules

- Preserve source-backed behavior and citation integrity.
- Do not fabricate references or claim evidence not returned by the retrieval pipeline.
- Social greetings/capability questions should not trigger unnecessary literature retrieval.
- A greeting combined with a real clinical question must still run the evidence flow.
- Spanish and English are independent editorial experiences.
- Query language should normally determine scientific-answer language; interface language is a fallback for ambiguous queries.
- Deterministic metadata may be localized; do not silently post-translate scientific claims in a way that breaks citations, source indices or confidence.

## Workflow

1. Start from current `main`.
2. Create `claude/<short-topic>`.
3. Inspect existing services before adding parallel logic.
4. Keep changes narrow and testable.
5. Run:
   ```bash
   npm ci
   npm test
   npm run benchmark:ranking
   ```
6. Open a PR and keep Backend tests + Ranking benchmark green.
7. Do not deploy or change production Supabase/DeepSeek/Dokploy settings without explicit approval.

## Secrets

Never commit `.env`, `SUPABASE_SERVICE_ROLE_KEY`, `DEEPSEEK_API_KEY`, database credentials or deployment secrets.

## Cross-repo changes

If an API contract changes, update the frontend client in `Steveu5/openphysio-frontend` in a coordinated PR. Prefer backward-compatible changes when deployments may not be simultaneous.

## Handoff

Read `docs/CLAUDE_CODE_HANDOFF.md` before substantial work.
