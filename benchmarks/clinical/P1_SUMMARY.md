# P1 validation summary (2026-09-28)

**Setup.** 11 cases / 18 operations from `cases.json`. `main` was run twice (`p1_before`, `p1_before2`) and the final P1 branch once (`p1_final`). All runs used the local API and local Supabase, cold. The full runs are local output in `runs/`, which is gitignored. Reproduce with:

`node tools/clinical-benchmark.js --only <ids> --label <label>`

## P0 signals

Confidence, safety (red flags), comparison detection and insufficient evidence are the same as on `main` in every case. Each final value matches at least one of the two `main` runs, which also differ between themselves because of retrieval variation.

## P1 checks

| Check | Result |
|---|---|
| History | Chat searches are stored as `chat` and are hidden from `/research/history`. Legacy rows are classified by `session_id`. |
| Degraded (forced invalid model output, real ledger) | Research and 3 Chat answers: 200, `charged: false`, every unit `released`, usage 0/0. The 4th Chat got 429 `DEGRADED_COOLDOWN`. Degraded Research was not cached. |
| Source/evidence alignment | Sufficiency, comparison support and confidence are computed on the cited sources. `evidenceAudit` was coherent in 11/11 Chat answers. |
| Chat sources per answer | 2 to 5, median 3 (previously always 4). |
| Research shape | Findings 3–5, relationships 2, uncertainties 2 (previously always 3/3). Consistency moderate/high/uncertain. |

## Cost and latency (server logs)

| | Chat | Research |
|---|---|---|
| Median answer length, chars (main → P1) | 2424 → 2231 | 3804 → 3080 |
| Cost per operation, USD (main → P1) | 0.00302 → 0.00254 | 0.00432 → 0.00399 |
| AI time p50 (main → P1) | 10.2 s → 8.4 s | 8.4 s → 6.7 s |
| Total time p50, excluding stalls (main → P1) | 14.1 s → 13.6 s | 15.8 s → 13.3 s |

Some operations stall about 40 s on external sources: Europe PMC timing out. This happens on both `main` and P1 and is tracked as separate work.
