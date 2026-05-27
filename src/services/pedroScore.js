function normalizeText(value = "") {
  return String(value || "").toLowerCase();
}

function isReviewOrGuideline(article = {}) {
  const studyType = normalizeText(article.study_type);
  const title = normalizeText(article.title);
  const evidenceLevel = normalizeText(article.evidence_level);

  // Important: do NOT use the abstract for this decision.
  // Systematic reviews often mention that they included randomized trials,
  // but that does not make the review itself a PEDro-scored trial.
  return (
    evidenceLevel === "systematic_review" ||
    evidenceLevel === "systematic_review_meta_analysis" ||
    evidenceLevel === "clinical_practice_guideline" ||
    studyType.includes("systematic review") ||
    studyType.includes("meta-analysis") ||
    studyType.includes("meta analysis") ||
    studyType.includes("clinical practice guideline") ||
    studyType.includes("practice guideline") ||
    title.includes("systematic review") ||
    title.includes("meta-analysis") ||
    title.includes("meta analysis") ||
    title.includes("clinical practice guideline")
  );
}

function isRandomizedTrial(article = {}) {
  if (isReviewOrGuideline(article)) return false;

  const studyType = normalizeText(article.study_type);
  const title = normalizeText(article.title);
  const evidenceLevel = normalizeText(article.evidence_level);

  // For PEDro applicability, classify only the article itself.
  // Avoid broad abstract matching because reviews/guidelines mention RCTs often.
  return (
    evidenceLevel === "randomized_controlled_trial" ||
    studyType.includes("randomized controlled trial") ||
    studyType.includes("randomised controlled trial") ||
    studyType === "randomized trial" ||
    studyType === "randomised trial" ||
    studyType.includes("clinical trial") ||
    title.includes("randomized controlled trial") ||
    title.includes("randomised controlled trial")
  );
}

function parsePedroScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(10, numeric));
}

function interpretPedroScore(score) {
  if (score === null || score === undefined) return null;
  if (score >= 9) return "Excelente";
  if (score >= 7) return "Alta";
  if (score >= 5) return "Moderada";
  return "Baja";
}

function calculatePedroQualityBoost(article = {}) {
  const pedroScore = parsePedroScore(article.pedro_score);
  const isNonApplicable = isReviewOrGuideline(article);
  const applies = !isNonApplicable && isRandomizedTrial(article);

  if (isNonApplicable) {
    return {
      pedro_score: null,
      // Keep the status/explanation for internal logic, but avoid showing a noisy
      // "PEDro: No aplica" badge on high-level evidence such as guidelines or reviews.
      pedro_score_label: null,
      pedro_score_status: "not_applicable",
      pedro_applicability: "reviews_and_guidelines_not_scored",
      pedro_quality_boost: 0,
      pedro_explanation: "PEDro score no aplica a revisiones sistemáticas ni guías clínicas.",
    };
  }

  if (pedroScore !== null && applies) {
    let boost = 0;
    if (pedroScore >= 9) boost = 10;
    else if (pedroScore >= 7) boost = 8;
    else if (pedroScore >= 5) boost = 4;
    else boost = -4;

    return {
      pedro_score: pedroScore,
      pedro_score_label: interpretPedroScore(pedroScore),
      pedro_score_status: "confirmed_or_imported",
      pedro_applicability: "applies_to_trial",
      pedro_quality_boost: boost,
      pedro_explanation: `PEDro score ${pedroScore}/10 aplicado a ensayo clínico.`,
    };
  }

  if (applies) {
    return {
      pedro_score: null,
      pedro_score_label: "No confirmado",
      pedro_score_status: "not_found_yet",
      pedro_applicability: "applies_but_not_available",
      pedro_quality_boost: 0,
      pedro_explanation: "Ensayo clínico potencialmente calificable con PEDro, pero aún no se encontró un PEDro score confirmado.",
    };
  }

  return {
    pedro_score: null,
    // For non-RCT evidence, keep PEDro invisible in article cards.
    pedro_score_label: null,
    pedro_score_status: "not_applicable",
    pedro_applicability: "not_a_trial",
    pedro_quality_boost: 0,
    pedro_explanation: "PEDro score solo aplica a ensayos clínicos aleatorizados.",
  };
}

module.exports = {
  calculatePedroQualityBoost,
  parsePedroScore,
  interpretPedroScore,
  isRandomizedTrial,
  isReviewOrGuideline,
};
