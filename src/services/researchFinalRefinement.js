const {
  refineResearchResults,
  queryScope,
} = require("./researchResultQuality");
const { normalizeText } = require("./conditionConcepts");
const { getPreferredSourcePriority } = require("./sourcePriority");
const { isProtocolEvidence } = require("./evidenceSelectionGuard");

const SPECIFIC_MODALITIES = [
  "pilates",
  "yoga",
  "tai chi",
  "aerobic",
  "aquatic",
  "water based",
  "hydrotherapy",
  "mckenzie",
  "motor control",
  "core based",
  "stabilization",
  "stabilisation",
  "strength training",
  "manual therapy",
  "manipulation",
  "mobilization",
  "mobilisation",
  "kinesiotaping",
  "hot spring",
  "balneotherapy",
];

const COMPARATOR_OR_ADJUNCT_TERMS = [
  "versus manual therapy",
  "vs manual therapy",
  "compared with manual therapy",
  "compared to manual therapy",
  "addition of manual therapy",
  "manual therapy to exercise",
  "exercise and manual therapy",
  "manual therapy combined with exercise",
];

const BROAD_COMPARISON_TERMS = [
  "network meta analysis",
  "network meta-analysis",
  "exercise modalities",
  "modes of exercise",
  "types of exercise",
  "exercise options",
  "dose parameters",
];

const SPECIFIC_POPULATIONS = [
  "athlete",
  "athletes",
  "elderly",
  "older adults",
  "pregnant",
  "pregnancy",
  "workers",
  "workplace",
];

function includesAny(text = "", terms = []) {
  const normalized = normalizeText(text);
  return terms.some((term) => normalized.includes(normalizeText(term)));
}

function evidenceText(article = {}) {
  return normalizeText(
    `${article.evidence_level || ""} ${article.study_type || ""}`
  );
}

function isReview(article = {}) {
  const text = evidenceText(article);
  return (
    text.includes("systematic review") ||
    text.includes("systematic_review") ||
    text.includes("meta analysis") ||
    text.includes("meta-analysis") ||
    normalizeText(article.journal).includes("cochrane")
  );
}

function isGuideline(article = {}) {
  const text = evidenceText(article);
  return (
    Boolean(article.library_resource) ||
    text.includes("guideline") ||
    text.includes("guia")
  );
}

function finalScope(article = {}, scope = {}) {
  if (isGuideline(article)) return "guideline";

  const title = normalizeText(article.title || "");
  const specificPopulation = includesAny(title, SPECIFIC_POPULATIONS);
  const specificModalities = SPECIFIC_MODALITIES.filter((term) =>
    title.includes(normalizeText(term))
  );
  const comparatorOrAdjunct = includesAny(title, COMPARATOR_OR_ADJUNCT_TERMS);
  const broadComparison = includesAny(title, BROAD_COMPARISON_TERMS);

  if (isReview(article)) {
    if (specificPopulation) return "specific_context";
    if (comparatorOrAdjunct) return "adjunct_or_comparator";
    if (broadComparison) return "comparative_synthesis";
    if (specificModalities.length > 0) return "specific_modality";
    return "broad_synthesis";
  }

  if (specificPopulation || specificModalities.length > 0) {
    return "specific_context";
  }

  return scope.broad_exercise_question
    ? "individual_study"
    : "matched_scope";
}

function roleForScope(article = {}, scope = {}, scopeMatch = "matched_scope") {
  if (article.library_resource || scopeMatch === "guideline") return "primary";
  if (!scope.broad_exercise_question) return article.evidence_role || "primary";

  if (["broad_synthesis", "comparative_synthesis"].includes(scopeMatch)) {
    return "primary";
  }

  if (
    [
      "adjunct_or_comparator",
      "specific_modality",
      "specific_context",
      "individual_study",
    ].includes(scopeMatch)
  ) {
    return "complementary";
  }

  return article.evidence_role || "context";
}

function applyFinalScores(article = {}, role = "primary", scopeMatch = "matched_scope") {
  let relevance = Number(article.query_relevance_score || 0);
  let priority = Number(article.reading_priority_score || 0);

  if (scopeMatch === "broad_synthesis") {
    relevance = Math.min(100, relevance + 3);
    priority = Math.min(100, priority + 5);
  } else if (scopeMatch === "comparative_synthesis") {
    relevance = Math.min(100, relevance + 1);
    priority = Math.min(100, priority + 2);
  }

  if (role === "complementary") {
    relevance = Math.min(relevance, 78);
    priority = Math.max(0, priority - 6);
  } else if (role === "context") {
    relevance = Math.min(relevance, 64);
    priority = Math.max(0, priority - 12);
  }

  const metadataComplete = Boolean(String(article.journal || "").trim());
  if (!metadataComplete && !article.library_resource) {
    priority = Math.max(0, priority - 10);
  }

  return {
    query_relevance_score: Number(relevance.toFixed(2)),
    reading_priority_score: Number(priority.toFixed(2)),
    bibliographic_metadata: metadataComplete ? "complete" : "incomplete",
  };
}

function scopeRank(scopeMatch = "") {
  return {
    guideline: 7,
    broad_synthesis: 6,
    comparative_synthesis: 5,
    matched_scope: 4,
    adjunct_or_comparator: 3,
    specific_modality: 2,
    specific_context: 2,
    individual_study: 1,
  }[scopeMatch] || 0;
}

function roleRank(role = "") {
  return { primary: 3, complementary: 2, context: 1 }[role] || 0;
}

function finalSort(articles = []) {
  return [...articles].sort((left, right) => {
    const libraryDifference =
      Number(Boolean(right.library_resource)) -
      Number(Boolean(left.library_resource));
    if (libraryDifference !== 0) return libraryDifference;

    const roleDifference = roleRank(right.evidence_role) - roleRank(left.evidence_role);
    if (roleDifference !== 0) return roleDifference;

    const scopeDifference = scopeRank(right.scope_match) - scopeRank(left.scope_match);
    if (scopeDifference !== 0) return scopeDifference;

    const protocolDifference =
      Number(isProtocolEvidence(left)) - Number(isProtocolEvidence(right));
    if (protocolDifference !== 0) return protocolDifference;

    const evidenceDifference =
      Number(right.evidence_level_rank || 0) -
      Number(left.evidence_level_rank || 0);
    if (evidenceDifference !== 0) return evidenceDifference;

    const sourceDifference =
      getPreferredSourcePriority(right).tier -
      getPreferredSourcePriority(left).tier;
    if (sourceDifference !== 0) return sourceDifference;

    const priorityDifference =
      Number(right.reading_priority_score || 0) -
      Number(left.reading_priority_score || 0);
    if (priorityDifference !== 0) return priorityDifference;

    return Number(right.year || 0) - Number(left.year || 0);
  });
}

function refineResearchResultsFinal(
  articles = [],
  intent = {},
  { query = "", limit = 20 } = {}
) {
  const base = refineResearchResults(articles, intent, { query, limit });
  const scope = queryScope(query, intent);

  const refined = base.articles.map((article) => {
    const scopeMatch = finalScope(article, scope);
    const role = roleForScope(article, scope, scopeMatch);
    const scores = applyFinalScores(article, role, scopeMatch);

    return {
      ...article,
      ...scores,
      scope_match: scopeMatch,
      evidence_role: role,
      clinical_directness:
        role === "primary"
          ? "direct"
          : role === "complementary"
            ? "complementary"
            : "indirect",
    };
  });

  const result = finalSort(refined).slice(0, Math.max(1, Number(limit) || 20));

  return {
    articles: result,
    diagnostics: {
      ...base.diagnostics,
      version: "1.2.0",
      final_ranking_version: "1.0.0",
      direct_count: result.filter((article) => article.evidence_role === "primary").length,
      complementary_count: result.filter(
        (article) => article.evidence_role === "complementary"
      ).length,
      indirect_count: result.filter((article) => article.evidence_role === "context").length,
      broad_synthesis_count: result.filter(
        (article) => article.scope_match === "broad_synthesis"
      ).length,
      comparative_synthesis_count: result.filter(
        (article) => article.scope_match === "comparative_synthesis"
      ).length,
      specific_context_count: result.filter((article) =>
        [
          "adjunct_or_comparator",
          "specific_modality",
          "specific_context",
          "individual_study",
        ].includes(article.scope_match)
      ).length,
      incomplete_metadata_count: result.filter(
        (article) => article.bibliographic_metadata === "incomplete"
      ).length,
      output_count: result.length,
    },
  };
}

module.exports = {
  finalScope,
  refineResearchResultsFinal,
};
