const { rankArticles } = require("./ranking");
const {
  BENCHMARK_VERSION,
  RANKING_BENCHMARK_CASES,
} = require("../../benchmarks/rankingCases");

const DEFAULT_THRESHOLDS = {
  top1_relevant_rate: { min: 0.9 },
  mean_reciprocal_rank: { min: 0.95 },
  ndcg_at_3: { min: 0.85 },
  precision_at_3: { min: 0.8 },
  pairwise_accuracy: { min: 0.95 },
  competing_condition_top3_rate: { max: 0.05 },
  protocol_top3_rate: { max: 0.1 },
};

function round(value, digits = 4) {
  return Number(Number(value || 0).toFixed(digits));
}

function mean(values = []) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function getRelevance(caseDefinition, articleId) {
  return Number(caseDefinition.relevance?.[articleId] || 0);
}

function gain(relevance) {
  return (2 ** Number(relevance || 0)) - 1;
}

function dcgAtK(relevances = [], k = 3) {
  return relevances.slice(0, k).reduce((score, relevance, index) => {
    const discount = Math.log2(index + 2);
    return score + gain(relevance) / discount;
  }, 0);
}

function ndcgAtK(rankedRelevances = [], idealRelevances = [], k = 3) {
  const idealDcg = dcgAtK(idealRelevances, k);
  if (idealDcg === 0) return 0;
  return dcgAtK(rankedRelevances, k) / idealDcg;
}

function reciprocalRank(relevances = [], minimumRelevantGrade = 2) {
  const firstRelevantIndex = relevances.findIndex(
    (relevance) => relevance >= minimumRelevantGrade
  );

  return firstRelevantIndex === -1 ? 0 : 1 / (firstRelevantIndex + 1);
}

function precisionAtK(relevances = [], k = 3, minimumRelevantGrade = 2) {
  if (k <= 0) return 0;
  const relevantCount = relevances
    .slice(0, k)
    .filter((relevance) => relevance >= minimumRelevantGrade)
    .length;

  return relevantCount / k;
}

function getPositionMap(rankedArticles = []) {
  return new Map(
    rankedArticles.map((article, index) => [article.id, index + 1])
  );
}

function evaluatePreferredPairs(rankedArticles = [], preferredPairs = []) {
  const positions = getPositionMap(rankedArticles);
  const results = preferredPairs.map(([preferredId, lowerPriorityId]) => {
    const preferredPosition = positions.get(preferredId) || Infinity;
    const lowerPriorityPosition = positions.get(lowerPriorityId) || Infinity;

    return {
      preferred_id: preferredId,
      lower_priority_id: lowerPriorityId,
      preferred_position: preferredPosition,
      lower_priority_position: lowerPriorityPosition,
      passed: preferredPosition < lowerPriorityPosition,
    };
  });

  return {
    results,
    correct: results.filter((result) => result.passed).length,
    total: results.length,
  };
}

function evaluateCase(caseDefinition, ranker = rankArticles) {
  const rankedArticles = ranker(
    caseDefinition.articles.map((article) => ({ ...article })),
    { ...caseDefinition.intent }
  );

  const rankedRelevances = rankedArticles.map((article) =>
    getRelevance(caseDefinition, article.id)
  );
  const idealRelevances = Object.values(caseDefinition.relevance || {})
    .map(Number)
    .sort((a, b) => b - a);
  const top3 = rankedArticles.slice(0, 3);
  const pairwise = evaluatePreferredPairs(
    rankedArticles,
    caseDefinition.preferred_pairs || []
  );

  const result = {
    id: caseDefinition.id,
    label: caseDefinition.label,
    top1_relevant: rankedRelevances[0] >= 2,
    reciprocal_rank: reciprocalRank(rankedRelevances),
    ndcg_at_3: ndcgAtK(rankedRelevances, idealRelevances, 3),
    precision_at_3: precisionAtK(rankedRelevances, 3),
    pairwise_correct: pairwise.correct,
    pairwise_total: pairwise.total,
    competing_condition_in_top3: top3.some((article) =>
      article.benchmark_tags?.includes("competing_condition")
    ),
    protocol_in_top3: top3.some((article) =>
      article.benchmark_tags?.includes("protocol")
    ),
    ranked_articles: rankedArticles.map((article, index) => ({
      rank: index + 1,
      id: article.id,
      relevance_grade: getRelevance(caseDefinition, article.id),
      reading_priority_score: article.reading_priority_score,
      query_relevance_score: article.query_relevance_score,
      evidence_score: article.openphysio_evidence_score,
      relevance_score: article.relevance_score,
      evidence_level: article.evidence_level,
      condition_match: article.condition_match,
    })),
    pairwise_results: pairwise.results,
  };

  result.violations = [];

  if (!result.top1_relevant) {
    result.violations.push("Top result is not directly relevant");
  }

  if (result.competing_condition_in_top3) {
    result.violations.push("Competing condition entered top 3");
  }

  if (result.protocol_in_top3) {
    result.violations.push("Protocol entered top 3");
  }

  for (const comparison of pairwise.results) {
    if (!comparison.passed) {
      result.violations.push(
        `${comparison.preferred_id} did not outrank ${comparison.lower_priority_id}`
      );
    }
  }

  return result;
}

function aggregateCaseResults(caseResults = []) {
  const totalCases = caseResults.length;
  const totalPairs = caseResults.reduce(
    (sum, result) => sum + result.pairwise_total,
    0
  );
  const correctPairs = caseResults.reduce(
    (sum, result) => sum + result.pairwise_correct,
    0
  );

  return {
    case_count: totalCases,
    article_count: caseResults.reduce(
      (sum, result) => sum + result.ranked_articles.length,
      0
    ),
    top1_relevant_rate: round(mean(
      caseResults.map((result) => result.top1_relevant ? 1 : 0)
    )),
    mean_reciprocal_rank: round(mean(
      caseResults.map((result) => result.reciprocal_rank)
    )),
    ndcg_at_3: round(mean(
      caseResults.map((result) => result.ndcg_at_3)
    )),
    precision_at_3: round(mean(
      caseResults.map((result) => result.precision_at_3)
    )),
    pairwise_accuracy: round(
      totalPairs ? correctPairs / totalPairs : 0
    ),
    competing_condition_top3_rate: round(mean(
      caseResults.map((result) =>
        result.competing_condition_in_top3 ? 1 : 0
      )
    )),
    protocol_top3_rate: round(mean(
      caseResults.map((result) => result.protocol_in_top3 ? 1 : 0)
    )),
    violation_count: caseResults.reduce(
      (sum, result) => sum + result.violations.length,
      0
    ),
  };
}

function evaluateThresholds(metrics, thresholds = DEFAULT_THRESHOLDS) {
  const checks = Object.entries(thresholds).map(([metric, rule]) => {
    const value = Number(metrics[metric]);
    const minPassed = rule.min == null || value >= rule.min;
    const maxPassed = rule.max == null || value <= rule.max;

    return {
      metric,
      value,
      min: rule.min ?? null,
      max: rule.max ?? null,
      passed: minPassed && maxPassed,
    };
  });

  return {
    passed: checks.every((check) => check.passed),
    checks,
  };
}

function runRankingBenchmark({
  cases = RANKING_BENCHMARK_CASES,
  ranker = rankArticles,
  thresholds = DEFAULT_THRESHOLDS,
} = {}) {
  const caseResults = cases.map((caseDefinition) =>
    evaluateCase(caseDefinition, ranker)
  );
  const metrics = aggregateCaseResults(caseResults);
  const thresholdEvaluation = evaluateThresholds(metrics, thresholds);

  return {
    benchmark_version: BENCHMARK_VERSION,
    generated_at: new Date().toISOString(),
    passed: thresholdEvaluation.passed,
    metrics,
    thresholds,
    threshold_checks: thresholdEvaluation.checks,
    cases: caseResults,
  };
}

module.exports = {
  DEFAULT_THRESHOLDS,
  round,
  mean,
  gain,
  dcgAtK,
  ndcgAtK,
  reciprocalRank,
  precisionAtK,
  evaluatePreferredPairs,
  evaluateCase,
  aggregateCaseResults,
  evaluateThresholds,
  runRankingBenchmark,
};
