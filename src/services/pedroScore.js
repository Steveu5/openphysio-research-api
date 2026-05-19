function normalizeText(value = "") {
  return String(value || "").toLowerCase();
}

function isRandomizedTrial(article = {}) {
  const text = [
    article.study_type,
    article.title,
    article.abstract,
    article.evidence_level,
  ].filter(Boolean).join(" ").toLowerCase();

  return (
    text.includes("randomized controlled trial") ||
    text.includes("randomised controlled trial") ||
    text.includes("randomized") ||
    text.includes("randomised") ||
    text.includes("clinical trial") ||
    article.evidence_level === "randomized_controlled_trial"
  );
}

function isReviewOrGuideline(article = {}) {
  const text = [
    article.study_type,
    article.title,
    article.abstract,
    article.evidence_level,
  ].filter(Boolean).join(" ").toLowerCase();

  return (
    text.includes("systematic review") ||
    text.includes("meta-analysis") ||
    text.includes("meta analysis") ||
    text.includes("clinical practice guideline") ||
    text.includes("practice guideline") ||
    article.evidence_level === "systematic_review" ||
    article.evidence_level === "systematic_review_meta_analysis" ||
    article.evidence_level === "clinical_practice_guideline"
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
  const applies = isRandomizedTrial(article);
  const isNonApplicable = isReviewOrGuideline(article) && !applies;

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

  if (isNonApplicable) {
    return {
      pedro_score: null,
      pedro_score_label: "No aplica",
      pedro_score_status: "not_applicable",
      pedro_applicability: "reviews_and_guidelines_not_scored",
      pedro_quality_boost: 0,
      pedro_explanation: "PEDro score no aplica a revisiones sistemáticas ni guías clínicas.",
    };
  }

  if (applies) {
    return {
      pedro_score: null,
      pedro_score_label: "No encontrado",
      pedro_score_status: "not_found_yet",
      pedro_applicability: "applies_but_not_available",
      pedro_quality_boost: 0,
      pedro_explanation: "Ensayo clínico potencialmente calificable con PEDro, pero aún no se encontró un PEDro score confirmado.",
    };
  }

  return {
    pedro_score: null,
    pedro_score_label: "No aplica",
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
};
