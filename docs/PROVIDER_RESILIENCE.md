# Evidence provider resilience (P2.1, issue #39)

## Active providers

OpenAlex is deliberately disabled: `searchOpenAlex` returns `[]` and is not budgeted.

| Provider | Requests per search | Comparison | Budget (total, shared in the operation) | Per attempt | Retries | Worst case before → after |
|---|---|---|---|---|---|---|
| PubMed (main + fallback, 2 JOSPT in sequence, up to 4 preferred-guideline queries; each esearch + efetch, serialized by the NCBI queue) | ~7 calls, ~14 HTTP | +1 call | **20 s** | 12 s / 15 s, capped by the remaining budget | 2 (never after a timeout; no fallback query after a timed-out primary) | minutes (unbounded chain) → ≤ 20 s |
| Europe PMC (main search + comparison search + Crossref enrichment) | 1 + enrichment | +1 | **10 s**, shared by all three uses | ≤ remaining budget | 1, only for a fast 429/5xx/network error that fits | ~46 s per use, up to ~140 s per search → ≤ 10 s |
| Crossref / Cochrane | 1 | – | **8 s** | ≤ remaining budget | 1 | ~72 s (4 × 18 s) → ≤ 8 s |
| Library guides (Supabase storage, internal) | 1–2 downloads | – | not budgeted (see follow-up) | – | – | – |

Budgets can be overridden with `PROVIDER_BUDGET_MS_PUBMED`, `PROVIDER_BUDGET_MS_EUROPE_PMC` and `PROVIDER_BUDGET_MS_CROSSREF`.

## Behaviour

**Budgets and aborts**
- One total budget per provider per search operation (`providerBudget`), starting when the provider fan-out starts.
- Every request is aborted with an AbortController at `min(attempt timeout, remaining budget)`. The abort covers the headers, the body, and the wait for an NCBI queue slot.
- A timeout is never retried.
- A spent budget means later requests are skipped at once (comparison and enrichment included).

**Partial and failed retrieval**
- A failed provider is fail-open: its branch returns `[]` and the rest continue.
- `retrieval.status` is `complete` / `partial` / `failed`.
- `important_failure` is true when PubMed failed, when two or more providers failed, or when no provider answered.
- If nothing usable was retrieved **and** there was an important failure, the answer is a technical degraded one:
  - it never says "no evidence";
  - it costs 0 units;
  - it doesn't count towards the degraded-answer cooldown;
  - Research makes no model call.

**Cache**
- The shared `research_query_cache` is written only for complete retrievals.
- The user's snapshot keeps `_openphysio_retrieval`.

**Diagnostics**
- Recorded per provider: `ok` / `empty` / `timeout` / `error` / `partial`, plus `timed_out`, `budget_ms`, `requests` and a short error without stack or URL.
- Research `sourceDiagnostics` show a timeout as `error` (the UI's "did not respond"), with `detail_status: "timeout"`.
- Chat and Research both expose `retrieval`.

**Alert**
- `provider-health-<source>` opens when a provider failed or timed out in ≥ 50% of ≥ 10 operations within 2 hours (`OPS_PROVIDER_FAILURE_RATE`, `OPS_PROVIDER_MIN_OPS`).
- It is read from the stored retrieval outcome. No migration.

## Follow-ups (not in this change)

- **Library guide excerpt download.** It goes through Supabase storage with no abort signal verified in `@supabase/storage-js` 2.108. A local stall was seen once. A bounded download needs either an abortable storage call or a signed-URL fetch with a budget.
