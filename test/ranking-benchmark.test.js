const test = require("node:test");
const assert = require("node:assert/strict");

const {
  RANKING_BENCHMARK_CASES,
} = require("../benchmarks/rankingCases");
const {
  dcgAtK,
  ndcgAtK,
  reciprocalRank,
  precisionAtK,
  evaluatePreferredPairs,
  evaluateThresholds,
  runRankingBenchmark,
} = require("../src/services/rankingBenchmark");

test("ranking benchmark covers every configured clinical condition", () => {
  assert.equal(RANKING_BENCHMARK_CASES.length, 12);

  for (const benchmarkCase of RANKING_BENCHMARK_CASES) {
    assert.ok(benchmarkCase.intent.condition);
    assert.ok(benchmarkCase.intent.intervention);
    assert.equal(benchmarkCase.articles.length, 6);
    assert.equal(Object.keys(benchmarkCase.relevance).length, 6);
    assert.equal(benchmarkCase.preferred_pairs.length, 3);
  }
});

test("ranking metrics calculate expected values", () => {
  const ranked = [3, 2, 0];
  const ideal = [3, 2, 0];

  assert.equal(reciprocalRank(ranked), 1);
  assert.equal(precisionAtK(ranked, 3), 2 / 3);
  assert.equal(ndcgAtK(ranked, ideal, 3), 1);
  assert.ok(dcgAtK([3, 2, 0], 3) > dcgAtK([2, 3, 0], 3));
});

test("preferred pair evaluation respects ranked positions", () => {
  const evaluation = evaluatePreferredPairs(
    [{ id: "a" }, { id: "b" }, { id: "c" }],
    [["a", "b"], ["c", "b"]]
  );

  assert.equal(evaluation.correct, 1);
  assert.equal(evaluation.total, 2);
  assert.equal(evaluation.results[0].passed, true);
  assert.equal(evaluation.results[1].passed, false);
});

test("threshold evaluator supports minimum and maximum gates", () => {
  const evaluation = evaluateThresholds(
    { quality: 0.9, leakage: 0.02 },
    { quality: { min: 0.8 }, leakage: { max: 0.05 } }
  );

  assert.equal(evaluation.passed, true);
  assert.ok(evaluation.checks.every((check) => check.passed));
});

test("current ranking clears the clinical regression benchmark", () => {
  const report = runRankingBenchmark();

  assert.equal(
    report.passed,
    true,
    JSON.stringify({
      metrics: report.metrics,
      failed_checks: report.threshold_checks.filter((check) => !check.passed),
      violations: report.cases
        .filter((item) => item.violations.length)
        .map((item) => ({ id: item.id, violations: item.violations })),
    }, null, 2)
  );
});
