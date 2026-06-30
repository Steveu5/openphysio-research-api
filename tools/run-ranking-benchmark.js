#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { runRankingBenchmark } = require("../src/services/rankingBenchmark");

function percent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function printSummary(report) {
  const { metrics } = report;

  console.log(`\nOpenPhysio ranking benchmark v${report.benchmark_version}`);
  console.log(`Status: ${report.passed ? "PASS" : "FAIL"}`);
  console.log(`Cases: ${metrics.case_count}`);
  console.log(`Articles: ${metrics.article_count}`);
  console.log(`Top-1 relevant: ${percent(metrics.top1_relevant_rate)}`);
  console.log(`MRR: ${metrics.mean_reciprocal_rank.toFixed(4)}`);
  console.log(`nDCG@3: ${metrics.ndcg_at_3.toFixed(4)}`);
  console.log(`Precision@3: ${percent(metrics.precision_at_3)}`);
  console.log(`Pairwise accuracy: ${percent(metrics.pairwise_accuracy)}`);
  console.log(`Competing condition in top 3: ${percent(metrics.competing_condition_top3_rate)}`);
  console.log(`Protocol in top 3: ${percent(metrics.protocol_top3_rate)}`);
  console.log(`Violations: ${metrics.violation_count}`);

  const failedChecks = report.threshold_checks.filter((check) => !check.passed);
  if (failedChecks.length) {
    console.log("\nFailed thresholds:");
    for (const check of failedChecks) {
      const expected = check.min != null
        ? `>= ${check.min}`
        : `<= ${check.max}`;
      console.log(`- ${check.metric}: ${check.value} (expected ${expected})`);
    }
  }

  const failedCases = report.cases.filter((item) => item.violations.length > 0);
  if (failedCases.length) {
    console.log("\nCase violations:");
    for (const item of failedCases) {
      console.log(`- ${item.id}: ${item.violations.join("; ")}`);
      console.log(`  top 3: ${item.ranked_articles.slice(0, 3).map((article) => article.id).join(", ")}`);
    }
  }
}

function writeReport(report) {
  const outputPath = process.env.BENCHMARK_REPORT_PATH;
  if (!outputPath) return;

  const absolutePath = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`\nReport written to ${absolutePath}`);
}

const report = runRankingBenchmark();
printSummary(report);
writeReport(report);

if (!report.passed) {
  process.exitCode = 1;
}
