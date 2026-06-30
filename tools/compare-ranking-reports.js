#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const HIGHER_IS_BETTER = new Set([
  "top1_relevant_rate",
  "mean_reciprocal_rank",
  "ndcg_at_3",
  "precision_at_3",
  "pairwise_accuracy",
]);

const LOWER_IS_BETTER = new Set([
  "competing_condition_top3_rate",
  "protocol_top3_rate",
  "violation_count",
]);

function loadReport(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function compareVersions(baseline = {}, candidate = {}) {
  const before = baseline.system?.component_versions || {};
  const after = candidate.system?.component_versions || {};
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();

  return keys
    .filter((key) => before[key] !== after[key])
    .map((key) => ({ component: key, baseline: before[key] || null, candidate: after[key] || null }));
}

function compareMetrics(baseline = {}, candidate = {}, tolerance = 0) {
  const before = baseline.metrics || {};
  const after = candidate.metrics || {};
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();

  return keys
    .filter((key) => typeof before[key] === "number" && typeof after[key] === "number")
    .map((key) => {
      const delta = Number((after[key] - before[key]).toFixed(6));
      let regression = false;

      if (HIGHER_IS_BETTER.has(key)) regression = delta < -tolerance;
      if (LOWER_IS_BETTER.has(key)) regression = delta > tolerance;

      return {
        metric: key,
        baseline: before[key],
        candidate: after[key],
        delta,
        regression,
      };
    });
}

function printComparison(baseline, candidate, comparison) {
  console.log("\nOpenPhysio ranking benchmark comparison");
  console.log(`Baseline: ${baseline.report_id || baseline.benchmark_version || "unknown"}`);
  console.log(`Candidate: ${candidate.report_id || candidate.benchmark_version || "unknown"}`);

  if (comparison.version_changes.length) {
    console.log("\nVersion changes:");
    for (const change of comparison.version_changes) {
      console.log(`- ${change.component}: ${change.baseline || "n/a"} -> ${change.candidate || "n/a"}`);
    }
  }

  console.log("\nMetric deltas:");
  for (const metric of comparison.metrics) {
    const marker = metric.regression ? "REGRESSION" : "ok";
    const sign = metric.delta > 0 ? "+" : "";
    console.log(`- ${metric.metric}: ${metric.baseline} -> ${metric.candidate} (${sign}${metric.delta}) [${marker}]`);
  }

  console.log(`\nCandidate threshold status: ${candidate.passed ? "PASS" : "FAIL"}`);
  console.log(`Regression status: ${comparison.passed ? "PASS" : "FAIL"}`);
}

const [baselinePath, candidatePath] = process.argv.slice(2);

if (!baselinePath || !candidatePath) {
  console.error("Usage: node tools/compare-ranking-reports.js <baseline.json> <candidate.json>");
  process.exit(2);
}

const tolerance = Number(process.env.BENCHMARK_REGRESSION_TOLERANCE || 0);
const baseline = loadReport(baselinePath);
const candidate = loadReport(candidatePath);
const metrics = compareMetrics(baseline, candidate, tolerance);
const comparison = {
  tolerance,
  version_changes: compareVersions(baseline, candidate),
  metrics,
  regressions: metrics.filter((item) => item.regression),
};
comparison.passed = Boolean(candidate.passed) && comparison.regressions.length === 0;

printComparison(baseline, candidate, comparison);

if (!comparison.passed) {
  process.exitCode = 1;
}

module.exports = {
  HIGHER_IS_BETTER,
  LOWER_IS_BETTER,
  compareVersions,
  compareMetrics,
};
