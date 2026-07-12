const {
  getConditionMatch,
  normalizeText,
} = require("./conditionConcepts");
const {
  getPreferredSourcePriority,
} = require("./sourcePriority");
const {
  isProtocolEvidence,
} = require("./evidenceSelectionGuard");

const PEDIATRIC_TERMS = [
  "child",
  "children",
  "adolescent",
  "adolescents",
  "pediatric",
  "paediatric",
  "youth",
  "niño",
  "niños",
  "niña",
  "niñas",
  "adolescente",
  "adolescentes",
  "pediatrico",
  "pediatrica",
];

const ADULT_TERMS = ["adult", "adults", "adulto", "adultos"];
const EXERCISE_TERMS = [
  "exercise",
  "training",
  "strength",
  "strengthening",
  "resistance",
  "motor control",
  "core",
  "stabilization",
  "stabilisation",
  "pilates",
  "yoga",
  "tai chi",
  "aerobic",
  "aquatic",
  "mckenzie",
  "physical activity",
  "ejercicio",
  "entrenamiento",
  "fortalecimiento",
  "actividad fisica",
];

const SPECIFIC_MODALITIES = [
  { key: "pilates", terms: ["pilates"] },
  { key: "yoga", terms: ["yoga"] },
  { key: "tai_chi", terms: ["tai chi"] },
  {
    key: "motor_control",
    terms: ["motor control", "core exercise", "core based", "stabilization", "stabilisation"],
  },
  {
    key: "strength",
    terms: ["strength training", "strengthening", "resistance training", "whole body strength"],
  },
  { key: "aquatic", terms: ["aquatic", "water based", "hydrotherapy"] },
  { key: "aerobic", terms: ["aerobic"] },
  { key: "mckenzie", terms: ["mckenzie"] },
  {
    key: "manual_therapy",
    terms: ["manual therapy", "manipulation", "mobilization", "mobilisation"],
  },
  { key: "kinesiotaping", terms: ["kinesiotaping", "kinesio taping"] },
  { key: "hot_spring", terms: ["hot spring", "balneotherapy"] },
  {
    key: "cognitive_functional",
    terms: ["cognitive functional therapy", "cognitive functional"],
  },
];

const SPECIFIC_POPULATION_TERMS = [
  "athlete",
  "athletes",
  "sports performance",
  "pregnant",
  "pregnancy",
  "older adults",
  "elderly",
  "workers",
  "workplace",
];

const BROAD_SYNTHESIS_TERMS = [
  "exercise therapy",
  "exercise intervention",
  "exercise interventions",
  "exercise modalities",
  "modes of exercise",
  "types of exercise",
  "network meta analysis",
  "systematic review",
  "clinical practice guideline",
  "practice guideline",
];

const GENERIC_REVIEW_DIFFERENCE_TERMS = new Set([
  "acute",
  "chronic",
  "non",
  "nonspecific",
  "specific",
  "treatment",
  "management",
  "adults",
  "adult",
  "updated",
  "update",
  "review",
]);

const TITLE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "of",
  "for",
  "the",
  "in",
  "on",
  "with",
  "to",
  "de",
  "del",
  "la",
  "el",
  "en",
  "para",
  "y",
]);

function articleText(article = {}) {
  return normalizeText(
    [article.title, article.abstract, article.population]
      .filter(Boolean)
      .join(" ")
  );
}

function titleText(article = {}) {
  return normalizeText(article.title || "");
}

function queryText(query = "", intent = {}) {
  return normalizeText(
    [
      query,
      intent.condition,
      intent.body_region,
      intent.intervention,
      intent.population,
      intent.normalized_query,
      ...(Array.isArray(intent.search_terms) ? intent.search_terms : []),
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function includesAny(text = "", terms = []) {
  return terms.some((term) => text.includes(normalizeText(term)));
}

function matchedSpecificModalities(text = "") {
  const normalized = normalizeText(text);
  return SPECIFIC_MODALITIES.filter((modality) =>
    modality.terms.some((term) => normalized.includes(normalizeText(term)))
  ).map((modality) => modality.key);
}

function queryRequestsPediatric(query = "", intent = {}) {
  return includesAny(queryText(query, intent), PEDIATRIC_TERMS);
}

function articleIsPediatricOnly(article = {}) {
  const title = titleText(article);
  const text = articleText(article);
  const pediatricInTitle = includesAny(title, PEDIATRIC_TERMS);
  const pediatricInText = includesAny(text, PEDIATRIC_TERMS);
  const adultInText = includesAny(text, ADULT_TERMS);

  return pediatricInTitle || (pediatricInText && !adultInText);
}

function requestedStage(query = "", intent = {}) {
  const text = queryText(query, intent);
  if (text.includes("chronic") || text.includes("cronico")) return "chronic";
  if (text.includes("acute") || text.includes("agudo")) return "acute";
  return null;
}

function hasStageMismatch(article = {}, stage = null) {
  if (!stage) return false;
  const title = titleText(article);

  if (stage === "chronic") {
    return (
      (title.includes("acute") || title.includes("agudo")) &&
      !title.includes("chronic") &&
      !title.includes("cronico")
    );
  }

  return (
    (title.includes("chronic") || title.includes("cronico")) &&
    !title.includes("acute") &&
    !title.includes("agudo")
  );
}

function queryRequestsExercise(query = "", intent = {}) {
  return includesAny(queryText(query, intent), EXERCISE_TERMS);
}

function articleTitleHasExercise(article = {}) {
  return includesAny(titleText(article), EXERCISE_TERMS);
}

function queryScope(query = "", intent = {}) {
  const text = queryText(query, intent);
  const modalities = matchedSpecificModalities(text);
  const populationSpecific = includesAny(text, SPECIFIC_POPULATION_TERMS);

  return {
    exercise_requested: queryRequestsExercise(query, intent),
    specific_modalities: modalities,
    population_specific: populationSpecific,
    broad_exercise_question:
      queryRequestsExercise(query, intent) &&
      modalities.length === 0 &&
      !populationSpecific,
  };
}

function isGuidelineArticle(article = {}) {
  const text = normalizeText(
    `${article.evidence_level || ""} ${article.study_type || ""}`
  );
  return (
    Boolean(article.library_resource) ||
    text.includes("guideline") ||
    text.includes("guia")
  );
}

function isReviewArticle(article = {}) {
  const text = normalizeText(
    `${article.evidence_level || ""} ${article.study_type || ""}`
  );
  return (
    text.includes("systematic review") ||
    text.includes("meta analysis") ||
    text.includes("systematic_review") ||
    isCochraneArticle(article)
  );
}

function articleScope(article = {}, scope = {}) {
  if (isGuidelineArticle(article)) return "guideline";

  const title = titleText(article);
  const modalities = matchedSpecificModalities(title);
  const populationSpecific = includesAny(title, SPECIFIC_POPULATION_TERMS);
  const broadSynthesis =
    isReviewArticle(article) &&
    includesAny(title, BROAD_SYNTHESIS_TERMS) &&
    modalities.length <= 1 &&
    !populationSpecific;

  if (broadSynthesis) return "broad_synthesis";
  if (modalities.length > 0 || populationSpecific) return "specific_context";
  if (isReviewArticle(article)) return "broad_synthesis";
  if (scope.broad_exercise_question) return "individual_study";
  return "matched_scope";
}

function isDirectConditionArticle(article = {}, intent = {}) {
  if (article.library_resource) return true;
  if (article.guideline_applicability === "direct") return true;

  const conditionMatch = getConditionMatch(article, intent);
  return Number(conditionMatch.title_matched_count || 0) > 0;
}

function adjustedScores(article = {}, directness = "direct", scopeMatch = "matched_scope") {
  let queryRelevance = Number(article.query_relevance_score || 0);
  let readingPriority = Number(article.reading_priority_score || 0);

  if (scopeMatch === "guideline") {
    queryRelevance = Math.min(100, queryRelevance + 2);
    readingPriority = Math.min(100, readingPriority + 3);
  } else if (scopeMatch === "broad_synthesis") {
    queryRelevance = Math.min(100, queryRelevance + 3);
    readingPriority = Math.min(100, readingPriority + 4);
  }

  if (directness === "complementary") {
    queryRelevance = Math.min(queryRelevance, 78);
    readingPriority = Math.max(0, readingPriority - 7);
  } else if (directness === "indirect") {
    queryRelevance = Math.min(queryRelevance, 64);
    readingPriority = Math.max(0, readingPriority - 14);
  }

  return {
    query_relevance_score: Number(queryRelevance.toFixed(2)),
    reading_priority_score: Number(readingPriority.toFixed(2)),
  };
}

function annotateClinicalDirectness(article = {}, query = "", intent = {}) {
  const stage = requestedStage(query, intent);
  const scope = queryScope(query, intent);
  const pediatricMismatch =
    !queryRequestsPediatric(query, intent) && articleIsPediatricOnly(article);
  const stageMismatch = hasStageMismatch(article, stage);
  const conditionDirect = isDirectConditionArticle(article, intent);
  const exerciseRequested = scope.exercise_requested;
  const interventionDirect =
    !exerciseRequested ||
    articleTitleHasExercise(article) ||
    Boolean(article.library_resource) ||
    isGuidelineArticle(article);
  const scopeMatch = articleScope(article, scope);
  const scopeSpecificForBroadQuestion =
    scope.broad_exercise_question &&
    ["specific_context", "individual_study"].includes(scopeMatch);

  let directness = "indirect";
  if (
    !pediatricMismatch &&
    !stageMismatch &&
    conditionDirect &&
    interventionDirect
  ) {
    directness = scopeSpecificForBroadQuestion ? "complementary" : "direct";
  }

  const limitations = [
    ...(Array.isArray(article.query_relevance_limitations)
      ? article.query_relevance_limitations
      : []),
  ];

  if (pediatricMismatch) limitations.push("población pediátrica no solicitada");
  if (stageMismatch) limitations.push("etapa clínica distinta de la consultada");
  if (!conditionDirect) limitations.push("la condición no aparece directamente en el título");
  if (!interventionDirect) limitations.push("la intervención solicitada no aparece directamente en el título");
  if (scopeSpecificForBroadQuestion) {
    limitations.push(
      "evalúa una modalidad, contexto o población específica dentro de una pregunta clínica amplia"
    );
  }

  const scores = adjustedScores(article, directness, scopeMatch);

  return {
    ...article,
    ...scores,
    clinical_directness: directness,
    evidence_role:
      directness === "direct"
        ? "primary"
        : directness === "complementary"
          ? "complementary"
          : "context",
    query_scope: scope.broad_exercise_question ? "broad" : "specific_or_unspecified",
    scope_match: scopeMatch,
    population_match: pediatricMismatch ? "mismatch" : "compatible",
    stage_match: stageMismatch ? "mismatch" : "compatible",
    intervention_match: interventionDirect ? "direct_or_broad" : "indirect",
    query_relevance_limitations: Array.from(new Set(limitations)),
  };
}

function isHighlyIndirect(article = {}) {
  if (article.library_resource) return false;
  if (article.population_match === "mismatch") return true;
  if (article.stage_match === "mismatch") return true;

  return (
    article.clinical_directness === "indirect" &&
    Number(article.query_relevance_score || 0) <= 65
  );
}

function titleTokens(title = "") {
  return normalizeText(title)
    .replace(/low back/g, "lowback")
    .split(/\s+/)
    .filter(
      (token) =>
        token.length > 1 &&
        !TITLE_STOP_WORDS.has(token) &&
        !/^\d{4}$/.test(token)
    );
}

function isCochraneArticle(article = {}) {
  return normalizeText(
    `${article.journal || ""} ${article.source_name || ""}`
  ).includes("cochrane");
}

function sameReviewFamily(left = {}, right = {}) {
  if (!isReviewArticle(left) || !isReviewArticle(right)) return false;
  if (isCochraneArticle(left) !== isCochraneArticle(right)) return false;

  const leftTokens = new Set(titleTokens(left.title));
  const rightTokens = new Set(titleTokens(right.title));
  const shared = [...leftTokens].filter((token) => rightTokens.has(token));
  const union = new Set([...leftTokens, ...rightTokens]);
  const similarity = union.size ? shared.length / union.size : 0;

  if (similarity >= 0.94) return true;

  const differences = [...union].filter(
    (token) => !leftTokens.has(token) || !rightTokens.has(token)
  );

  return (
    similarity >= 0.72 &&
    differences.length > 0 &&
    differences.every((token) => GENERIC_REVIEW_DIFFERENCE_TERMS.has(token))
  );
}

function preferredVersion(left = {}, right = {}) {
  const leftProtocol = isProtocolEvidence(left);
  const rightProtocol = isProtocolEvidence(right);
  if (leftProtocol !== rightProtocol) return leftProtocol ? right : left;

  const yearDifference = Number(right.year || 0) - Number(left.year || 0);
  if (yearDifference !== 0) return yearDifference > 0 ? right : left;

  return Number(right.reading_priority_score || 0) >
    Number(left.reading_priority_score || 0)
    ? right
    : left;
}

function collapseReviewVersions(articles = []) {
  const kept = [];
  let collapsedCount = 0;

  for (const article of articles) {
    const existingIndex = kept.findIndex((current) =>
      sameReviewFamily(current, article)
    );

    if (existingIndex === -1) {
      kept.push(article);
      continue;
    }

    kept[existingIndex] = preferredVersion(kept[existingIndex], article);
    collapsedCount += 1;
  }

  return { articles: kept, collapsedCount };
}

function directnessRank(article = {}) {
  if (article.clinical_directness === "direct") return 3;
  if (article.clinical_directness === "complementary") return 2;
  return 1;
}

function scopeRank(article = {}) {
  const ranks = {
    guideline: 5,
    broad_synthesis: 4,
    matched_scope: 3,
    specific_context: 2,
    individual_study: 1,
  };
  return ranks[article.scope_match] || 0;
}

function sortClinicalArticles(articles = []) {
  return [...articles].sort((left, right) => {
    const libraryDifference =
      Number(Boolean(right.library_resource)) -
      Number(Boolean(left.library_resource));
    if (libraryDifference !== 0) return libraryDifference;

    const directDifference = directnessRank(right) - directnessRank(left);
    if (directDifference !== 0) return directDifference;

    const scopeDifference = scopeRank(right) - scopeRank(left);
    if (scopeDifference !== 0) return scopeDifference;

    const protocolDifference =
      Number(isProtocolEvidence(left)) - Number(isProtocolEvidence(right));
    if (protocolDifference !== 0) return protocolDifference;

    const evidenceDifference =
      Number(right.evidence_level_rank || 0) -
      Number(left.evidence_level_rank || 0);
    if (evidenceDifference !== 0) return evidenceDifference;

    const sourceTierDifference =
      getPreferredSourcePriority(right).tier -
      getPreferredSourcePriority(left).tier;
    if (sourceTierDifference !== 0) return sourceTierDifference;

    const readingDifference =
      Number(right.reading_priority_score || 0) -
      Number(left.reading_priority_score || 0);
    if (readingDifference !== 0) return readingDifference;

    return Number(right.year || 0) - Number(left.year || 0);
  });
}

function refineResearchResults(
  articles = [],
  intent = {},
  { query = "", limit = 20 } = {}
) {
  const annotated = articles.map((article) =>
    annotateClinicalDirectness(article, query, intent)
  );
  const compatible = annotated.filter(
    (article) =>
      article.population_match !== "mismatch" &&
      article.stage_match !== "mismatch"
  );
  const nonIndirect = compatible.filter((article) => !isHighlyIndirect(article));
  const usefulPool = nonIndirect.filter((article) =>
    ["direct", "complementary"].includes(article.clinical_directness)
  );

  const selectedPool =
    usefulPool.length >= Math.min(10, Number(limit) || 20)
      ? usefulPool
      : compatible;

  const completedCount = selectedPool.filter(
    (article) => !isProtocolEvidence(article)
  ).length;
  const protocolFiltered =
    completedCount >= 8
      ? selectedPool.filter((article) => !isProtocolEvidence(article))
      : selectedPool;

  const collapsed = collapseReviewVersions(protocolFiltered);
  const sorted = sortClinicalArticles(collapsed.articles);
  const result = sorted.slice(0, Math.max(1, Number(limit) || 20));

  return {
    articles: result,
    diagnostics: {
      version: "1.1.0",
      input_count: articles.length,
      population_mismatch_removed:
        annotated.length -
        annotated.filter((article) => article.population_match !== "mismatch").length,
      stage_mismatch_removed:
        annotated.filter((article) => article.stage_match === "mismatch").length,
      highly_indirect_removed:
        compatible.length - nonIndirect.length,
      protocols_removed:
        selectedPool.length - protocolFiltered.length,
      review_versions_collapsed: collapsed.collapsedCount,
      direct_count: result.filter(
        (article) => article.clinical_directness === "direct"
      ).length,
      complementary_count: result.filter(
        (article) => article.clinical_directness === "complementary"
      ).length,
      indirect_count: result.filter(
        (article) => article.clinical_directness === "indirect"
      ).length,
      broad_synthesis_count: result.filter(
        (article) => article.scope_match === "broad_synthesis"
      ).length,
      specific_context_count: result.filter(
        (article) => article.scope_match === "specific_context"
      ).length,
      query_scope: queryScope(query, intent).broad_exercise_question
        ? "broad_exercise"
        : "specific_or_unspecified",
      output_count: result.length,
    },
  };
}

module.exports = {
  articleIsPediatricOnly,
  hasStageMismatch,
  queryScope,
  articleScope,
  annotateClinicalDirectness,
  isHighlyIndirect,
  sameReviewFamily,
  collapseReviewVersions,
  refineResearchResults,
};
