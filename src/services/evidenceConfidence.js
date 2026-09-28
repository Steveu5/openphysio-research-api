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

const VERSION = "2.1.0";

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
    es: "Hay evidencia directa sobre la condición y la pregunta, pero su calidad metodológica no está suficientemente establecida, es escasa o no es consistente en todos los aspectos consultados.",
    en: "There is direct evidence on the condition and the question, but its methodological quality is not sufficiently established, it is limited, or it is not consistent across every aspect asked.",
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

function isSynthesisOrGuideline(article = {}) {
  const text = `${article.evidence_level || ""} ${article.study_type || ""}`.toLowerCase();
  return /systematic|meta.?analys|guideline|cochrane/.test(text) || Boolean(article.library_resource);
}

const REPORTED_LIMITATIONS = "limitaciones metodológicas reportadas";

// Methodological quality that the available data actually establishes; a
// design label alone ("RCT", "review") is not enough. Signals, all already
// computed by evidenceScoring: PEDro when known (>= 6 good, <= 4 poor), and
// for syntheses and guidelines, whether the abstract reports a formal
// appraisal (risk of bias or certainty/GRADE) without reporting
// methodological limitations or low certainty. A single trial without a
// PEDro score, or a review that does not report its appraisal, stays
// "uncertain quality". No risk-of-bias score is invented.
const REPORTED_APPRAISAL = [
  "reporta evaluación de riesgo de sesgo/calidad",
  "reporta certeza/calidad de evidencia",
];

function hasEstablishedQuality(article = {}) {
  if (!isHighQuality(article)) return false;
  if (article.pedro_score != null && Number.isFinite(Number(article.pedro_score))) {
    const pedro = Number(article.pedro_score);
    if (pedro <= 4) return false;
    if (pedro >= 6) return true;
  }
  if ((article.caution_flags || []).includes(REPORTED_LIMITATIONS)) return false;
  const appraisal = article.appraisal_flags || [];
  return (
    isSynthesisOrGuideline(article) &&
    REPORTED_APPRAISAL.some((flag) => appraisal.includes(flag))
  );
}

// consistent | conflicting | uncertain, from the answer model (Chat:
// consistent/mixed/conflicting/unclear) or Research (high/moderate/low/uncertain).
function consistencyOf(value) {
  const key = String(value || "").toLowerCase();
  if (["low", "conflicting"].includes(key)) return "conflicting";
  if (["consistent", "high", "moderate"].includes(key)) return "consistent";
  return "uncertain";
}

function clampToBand(score, key) {
  const [min, max] = BANDS[key];
  return Math.round(Math.max(min, Math.min(max, score)));
}

function assessEvidenceConfidence(
  articles = [],
  {
    intent = {},
    language = "es",
    mode = "chat",
    comparison = null,
    consistency = null,
    // Before the answer model runs, consistency is not known yet: it does
    // not block High, and the final assessment re-checks it.
    consistencyPending = false,
  } = {}
) {
  const lang = language === "en" ? "en" : "es";
  const top = (Array.isArray(articles) ? articles : []).slice(0, mode === "chat" ? 4 : 8);
  const direct = top.filter((article) => tierOf(article) === "direct");
  const partial = top.filter((article) => tierOf(article) === "partial");
  const tangential = top.filter((article) => tierOf(article) === "tangential");
  const directHighQuality = direct.filter(isHighQuality);
  const directEstablished = direct.filter(hasEstablishedQuality);
  const abstractCoverage = top.length
    ? top.filter((article) => Boolean(article.abstract)).length / top.length
    : 0;
  const mainSources = top.slice(0, 2);
  const mainTangential = mainSources.some((article) => tierOf(article) === "tangential");
  const underspecified =
    !intent.condition && CLINICAL_QUESTION_TYPES.has(intent.question_type || "treatment");
  const comparisonWithoutDirect = Boolean(comparison?.requested && !comparison.direct);
  const consistencyKey = consistencyOf(consistency);
  const conflicting = consistencyKey === "conflicting";
  const consistencyOk = consistencyPending || consistencyKey === "consistent";

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
    // High needs established quality, not only a high design label: at
    // least two direct sources whose quality is supported by the data, one
    // of them a synthesis or guideline, and consistent findings.
    directEstablished.length >= 2 &&
    directEstablished.some(isSynthesisOrGuideline) &&
    consistencyOk &&
    direct.length >= Math.min(3, top.length) &&
    tangential.length === 0 &&
    abstractCoverage >= 0.75 &&
    !underspecified
  ) {
    key = "high";
    rationaleKey = "high";
  } else if (directHighQuality.length >= 1 || directEstablished.length >= 1) {
    // Direct evidence whose methodological quality is uncertain.
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
      direct_established_quality_articles: directEstablished.length,
      abstract_coverage: Number(abstractCoverage.toFixed(2)),
      comparison_without_direct_evidence: comparisonWithoutDirect,
      underspecified_question: underspecified,
      consistency: consistencyPending ? "pending" : consistencyKey,
      raw_score: Math.round(rawScore),
    },
  };
}

module.exports = {
  VERSION,
  hasEstablishedQuality,
  LABELS,
  assessEvidenceConfidence,
};
