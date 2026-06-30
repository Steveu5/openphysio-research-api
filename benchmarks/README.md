# OpenPhysio ranking benchmark

This benchmark is an offline regression suite for the scientific evidence ranking pipeline. It does not call external APIs and uses deterministic synthetic records designed to expose common ranking failures.

## Coverage

The benchmark includes 12 musculoskeletal conditions:

- chronic low back pain
- mechanical neck pain
- cervical radiculopathy
- rotator cuff related shoulder pain
- knee osteoarthritis
- hip osteoarthritis
- patellofemoral pain
- Achilles tendinopathy
- patellar tendinopathy
- lateral elbow tendinopathy
- plantar heel pain
- lateral ankle sprain

Each case contains six competing records:

1. target clinical practice guideline
2. target systematic review and meta-analysis
3. target randomized controlled trial
4. target study protocol
5. high-level evidence for a competing condition
6. target economic or secondary-focus study

## Metrics

The regression gate evaluates:

- top-1 direct relevance rate
- mean reciprocal rank
- nDCG@3
- precision@3
- pairwise preference accuracy
- competing-condition leakage into the top 3
- protocol leakage into the top 3

Relevance grades are explicit and version-controlled in `rankingCases.js`:

- `3`: directly relevant, high-level evidence
- `2`: directly relevant intervention study
- `1`: related but secondary to the clinical question
- `0`: not appropriate for early reading priority

## Commands

Run the benchmark:

```bash
npm run benchmark:ranking
```

Write the full JSON report:

```bash
BENCHMARK_REPORT_PATH=artifacts/ranking-benchmark.json npm run benchmark:ranking
```

Run only the benchmark tests:

```bash
node --test test/ranking-benchmark.test.js
```

The command exits with status `1` when one or more quality thresholds fail. The GitHub Actions workflow uploads the JSON report even when the gate fails.

## Extending the benchmark

When adding a condition or a new failure mode:

1. Add a case definition or a dedicated custom case.
2. Assign relevance grades before inspecting the algorithm output.
3. Add explicit preferred pairs for clinically important ordering constraints.
4. Increase the benchmark version when the evaluation contract changes.
5. Do not lower thresholds solely to make a ranking change pass; inspect the failed cases first.
