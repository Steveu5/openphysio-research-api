# Clinical behavior benchmark

`cases.json` holds 26 fictitious clinical questions covering condition
matching, comparisons (with and without head-to-head studies), prognosis,
diagnosis, return to sport, dosing, follow-ups with context, limited
evidence, red flags and ambiguous questions. Each case lists generic
expectations (`expect`); product code must never special-case these
questions.

`tools/clinical-benchmark.js` runs every case against a live API (Chat
and/or Research), and records the following per case:

- parsed intent (PICO, question type);
- top sources with their scores, applicability tier and match trace;
- whether a Library guide ranks first;
- confidence;
- comparison and safety assessments;
- duplicates;
- an answer excerpt.

It also records cost and latency from the local `usage_reservations` ledger.

## Run locally (never against production)

Requirements:

- a local Supabase stack with the frontend migrations applied;
- the Library catalog seeded;
- a local paid test user;
- the API started against that stack with a real `DEEPSEEK_API_KEY`.

Reset local caches between runs (`research_query_cache`,
`research_search_results`, `research_articles`, `research_search_queries`, and
the test user's usage rows), so every run is cold and comparable.

```bash
BENCH_API_ROOT=http://127.0.0.1:3099 \
BENCH_SUPABASE_URL=http://127.0.0.1:54321 BENCH_ANON_KEY=... BENCH_SERVICE_KEY=... \
BENCH_EMAIL=bench@clinical.test BENCH_PASSWORD=... \
  node tools/clinical-benchmark.js --label after [--only case_id,case_id]

node tools/clinical-benchmark.js --compare before_cold after
node tools/clinical-benchmark.js --rescore <label>   # re-apply current case rules
```

Each run costs about USD 0.07 of DeepSeek usage (38 operations) and takes
about 10 minutes.

## Where runs are stored

New runs are written to `benchmarks/clinical/runs/<label>.json`. That folder is gitignored, because full runs are large and temporary. `--compare` and `--rescore` read from `runs/` first, then from `results/`.

`results/` keeps only the reference runs of the P0 clinical-quality work:

| file | code |
|---|---|
| `before.json`, `before_cold.json`, `before_final.json` | `main` before P0 |
| `phase2.json`, `phase3.json` | P0 intermediate phases |
| `after_v1.json`, `after_v2.json`, `after.json`, `after_final.json` | P0 iterations and final |
| `validation3.json` | P0 confidence calibration check |

P1 sample runs are summarized in `P1_SUMMARY.md` and are not versioned.
