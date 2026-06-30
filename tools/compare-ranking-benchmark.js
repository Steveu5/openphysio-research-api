#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const baselinePath = process.argv[2];
const candidatePath = process.argv[3];

if (!baselinePath || !candidatePath) {
  console.error("Usage: node tools/compare-ranking-benchmark.js <baseline.json> <candidate.json>");
  process.exit(2);
}

function readJson(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

const baseline = readJson(baselinePath);
const candidate = readJson(candidatePath);

const higherIsBetter = [
  "top1_relevant_rate",
  "mean_reciprocal_rank",
  "ndcg_at_3",
  "precision_at_3",
  "pairwise_accuracy",
];

const lowerIsBetter = [
  "competing_condition_top3_rate",
  "protocol_top3_rate",
  "violation_count",
];

const tolerances = {
  top1_relevant_rate: 0,
  mean_reciprocal_rank: 0.005,
  ndcg_at_3: 0.01,
  precision_at_3: 0.01,
  pairwise_accuracy: 0.005,
  competing_condition_top3_rate: 0,
  protocol_top3_rate: 0,
  violation_count: 0,
};

const comparisons = [];

for (const metric of higherIsBetter) {
  const before = Number(baseline.metrics?.[metric] || 0);
  const after = Number(candidate.metrics?.[metric] || 0);
  const tolerance = tolerances[metric] || 0;
  comparisons.push({
    metric,
    baseline: before,
    candidate: after,
    delta: Number((after - before).toFixed(4)),
    passed: after + tolerance >= before,
  });
}

for (const metric of lowerIsBetter) {
  const before = Number(baseline.metrics?.[metric] || 0);
  const after = Number(candidate.metrics?.[metric] || 0);
  const tolerance = tolerances[metric] || 0;
  comparisons.push({
    metric,
    baseline: before,
    candidate: after,
    delta: Number((after - before).toFixed(4)),
    passed: after <= before + tolerance,
  });
}

const passed = comparisons.every((comparison) => comparison.passed) && candidate.passed;

console.log(`Baseline ranking: v${baseline.research_system?.ranking_version || "unknown"}`);
console.log(`Candidate ranking: v${candidate.research_system?.ranking_version || "unknown"}`);
console.log(`Regression status: ${passed ? "PASS" : "FAIL"}`);

for (const comparison of comparisons) {
  console.log(
    `${comparison.passed ? "PASS" : "FAIL"} ${comparison.metric}: ` +
    `${comparison.baseline} -> ${comparison.candidate} (${comparison.delta >= 0 ? "+" : ""}${comparison.delta})`
  );
}

if (!passed) process.exitCode = 1;
