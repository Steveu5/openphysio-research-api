// Confidence in the evidence behind an answer (Chat) or a reading list
// (Research), computed from the clinical-match trace of the sources used:
// relevance and applicability (tiers), design quality, quantity,
// consistency and directness (comparisons).
//
// Categories: high, moderate, limited, indirect, conflicting. The category is
// decided by explicit rules; the 0-100 score is kept for continuity and is
// always clamped to the band of its category, so the two never disagree.
//
// Never "high" when the evidence is indirect, the main sources are
// tangential or about another condition, a comparison has no head-to-head
// study, or the question itself is underspecified.

const VERSION = "2.0.0";

const LABELS = {
  es: { high: "Alto", moderate: "Moderado", limited: "Limitado", indirect: "Indirecto", conflicting: "Contradictorio" },
  en: { high: "High", moderate: "Moderate", limited: "Limited", indirect: "Indirect", conflicting: "Conflicting" },
};

const BANDS = {
  high: [75, 90],
  moderate: [55, 74],
  conflicting: [35, 54],
  indirect: [30, 54],
  limited: [10, 45],
};

const RATIONALES = {
  high: {
    es: "Varias fuentes de alta calidad abordan directamente la condición y la pregunta, sin fuentes tangenciales entre las principales.",
    en: "Several high-quality sources directly address the condition and the question, with no tangential sources among the main ones.",
  },
  moderate: {
    es: "Hay evidencia directa sobre la condición y la pregunta, pero es escasa, de calidad heterogénea o no cubre todos los aspectos consultados.",
    en: "There is direct evidence on the condition and the question, but it is limited in quantity, mixed in quality or does not cover every aspect asked.",
  },
  indirect: {
    es: "La evidencia recuperada es indirecta: aborda la condición o las intervenciones por separado, o una pregunta relacionada, no exactamente la consultada.",
    en: "The retrieved evidence is indirect: it addresses the condition or the interventions separately, or a related question, not exactly the one asked.",
  },
  indirect_comparison: {
    es: "No se recuperaron comparaciones directas entre las opciones consultadas; cualquier comparación es una inferencia indirecta.",
    en: "No head-to-head comparisons of the options asked were retrieved; any comparison is an indirect inference.",
  },
  conflicting: {
    es: "Las fuentes directas muestran resultados contradictorios entre sí.",
    en: "The direct sources report contradictory results.",
  },
  limited: {
    es: "La evidencia directamente aplicable es escasa o de baja jerarquía.",
    en: "Directly applicable evidence is scarce or low in the evidence hierarchy.",
  },
  underspecified: {
    es: "La pregunta no identifica una condición concreta; la evidencia orienta de forma general y la evaluación clínica debe definir el cuadro.",
    en: "The question does not identify a specific condition; the evidence gives general orientation and the clinical assessment must define the presentation.",
  },
};

const CLINICAL_QUESTION_TYPES = new Set([
  "treatment", "comparison", "diagnosis", "prognosis", "progression", "return_to_sport", "interpretation", "safety",
]);

function tierOf(article = {}) {
  return article.clinical_match?.tier || null;
}

function isHighQuality(article = {}) {
  const design = article.clinical_match?.components?.design;
  if (design != null) return design >= 0.7;
  return Number(article.evidence_level_rank || 0) >= 7;
}

function clampToBand(score, key) {
  const [min, max] = BANDS[key];
  return Math.round(Math.max(min, Math.min(max, score)));
}

function assessEvidenceConfidence(
  articles = [],
  { intent = {}, language = "es", mode = "chat", comparison = null, consistency = null } = {}
) {
  const lang = language === "en" ? "en" : "es";
  const top = (Array.isArray(articles) ? articles : []).slice(0, mode === "chat" ? 4 : 8);
  const direct = top.filter((article) => tierOf(article) === "direct");
  const partial = top.filter((article) => tierOf(article) === "partial");
  const tangential = top.filter((article) => tierOf(article) === "tangential");
  const directHighQuality = direct.filter(isHighQuality);
  const abstractCoverage = top.length
    ? top.filter((article) => Boolean(article.abstract)).length / top.length
    : 0;
  const mainSources = top.slice(0, 2);
  const mainTangential = mainSources.some((article) => tierOf(article) === "tangential");
  const underspecified =
    !intent.condition && CLINICAL_QUESTION_TYPES.has(intent.question_type || "treatment");
  const comparisonWithoutDirect = Boolean(comparison?.requested && !comparison.direct);
  const conflicting = ["low", "conflicting"].includes(String(consistency || "").toLowerCase());

  // Interpretable score: share of direct sources, their quality, quantity
  // and metadata. Only used inside the band chosen by the rules below.
  const rawScore =
    100 *
    (0.4 * (top.length ? direct.length / top.length : 0) +
      0.25 * Math.min(1, directHighQuality.length / 2) +
      0.15 * Math.min(1, top.length / 4) +
      0.1 * abstractCoverage +
      0.1 * (top.length ? 1 - tangential.length / top.length : 0));

  let key;
  let rationaleKey;
  if (!top.length || (!direct.length && !partial.length)) {
    key = "limited";
    rationaleKey = "limited";
  } else if (comparisonWithoutDirect) {
    key = "indirect";
    rationaleKey = "indirect_comparison";
  } else if (!direct.length || mainTangential || tangential.length > direct.length) {
    key = "indirect";
    rationaleKey = "indirect";
  } else if (conflicting) {
    key = "conflicting";
    rationaleKey = "conflicting";
  } else if (
    directHighQuality.length >= 2 &&
    direct.length >= Math.min(3, top.length) &&
    tangential.length === 0 &&
    abstractCoverage >= 0.75 &&
    !underspecified
  ) {
    key = "high";
    rationaleKey = "high";
  } else if (directHighQuality.length >= 1) {
    key = "moderate";
    rationaleKey = underspecified ? "underspecified" : "moderate";
  } else {
    key = "limited";
    rationaleKey = "limited";
  }

  return {
    level: LABELS[lang][key],
    level_key: key,
    score: clampToBand(rawScore, key),
    rationale: RATIONALES[rationaleKey][lang],
    metrics: {
      confidence_model_version: VERSION,
      article_count: top.length,
      direct_articles: direct.length,
      partial_articles: partial.length,
      tangential_articles: tangential.length,
      direct_high_quality_articles: directHighQuality.length,
      abstract_coverage: Number(abstractCoverage.toFixed(2)),
      comparison_without_direct_evidence: comparisonWithoutDirect,
      underspecified_question: underspecified,
      consistency: consistency || null,
      raw_score: Math.round(rawScore),
    },
  };
}

module.exports = {
  VERSION,
  LABELS,
  assessEvidenceConfidence,
};
