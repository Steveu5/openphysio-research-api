const { enrichEvidenceMetadata } = require("./evidenceLevel");
const { calculateTrustedSourceBoost } = require("./trustedSources");
const { calculateOpenPhysioEvidenceScore, calculateQueryRelevanceScore } = require("./evidenceScoring");
const {
  getConditionTerms,
  getConditionMatchDetails,
} = require("./preferredGuidelineSearch");
const {
  RANKING_ALGORITHM_VERSION,
  RANKING_WEIGHTS_VERSION,
  RANKING_WEIGHTS,
} = require("../config/rankingConfig");

function studyTypeScore(article = {}) {
  const evidenceRank = Number(article.evidence_level_rank || 1);
  return evidenceRank * RANKING_WEIGHTS.study_type.evidence_rank_multiplier;
}

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function textIncludes(value, term) {
  if (!value || !term) return false;
  return normalizeText(value).includes(normalizeText(term));
}

function containsAny(text, terms = []) {
  const normalized = normalizeText(text);
  return terms.some((term) => normalized.includes(normalizeText(term)));
}

function hasAdultIntent(intent = {}) {
  const text = `${intent.population || ""} ${(intent.search_terms || []).join(" ")}`.toLowerCase();
  return text.includes("adult") || text.includes("older") || text.includes("elderly");
}

function hasOlderAdultIntent(intent = {}) {
  const text = `${intent.population || ""} ${(intent.search_terms || []).join(" ")}`.toLowerCase();
  return text.includes("older") || text.includes("elderly") || text.includes("aged") || text.includes("60");
}

function isLikelyProtocol(article = {}) {
  const title = normalizeText(article.title);
  const studyType = normalizeText(article.study_type);
  const abstract = normalizeText(article.abstract);

  const titleOrTypeLooksLikeProtocol = [
    "study protocol",
    "protocol for",
    "trial protocol",
    "protocol of",
    "protocol paper",
    "registered protocol",
  ].some((term) => title.includes(term) || studyType.includes(term));

  if (titleOrTypeLooksLikeProtocol) return true;

  const completedReviewSignals =
    title.includes("systematic review") ||
    title.includes("meta-analysis") ||
    title.includes("meta analysis") ||
    studyType.includes("systematic review") ||
    studyType.includes("meta-analysis") ||
    studyType.includes("meta analysis") ||
    abstract.includes("we included") ||
    abstract.includes("were included") ||
    abstract.includes("meta-analysis was performed") ||
    abstract.includes("systematic review and meta-analysis") ||
    abstract.includes("this meta-analysis") ||
    abstract.includes("this systematic review");

  if (completedReviewSignals) return false;

  return (
    title === "protocol" ||
    title.endsWith(" protocol") ||
    studyType === "protocol" ||
    studyType.includes("protocol article") ||
    abstract.includes("this protocol describes") ||
    abstract.includes("the protocol describes") ||
    abstract.includes("we describe the protocol") ||
    abstract.includes("aim of this protocol") ||
    abstract.includes("protocol has been registered")
  );
}

function calculateReadingPriorityPenalty(article = {}) {
  let penalty = 0;
  const title = normalizeText(article.title);
  const evidenceLevel = normalizeText(article.evidence_level);
  const label = normalizeText(article.evidence_level_label_es);
  const weights = RANKING_WEIGHTS.reading_priority_penalties;

  if (isLikelyProtocol(article) || label.includes("protocolo") || evidenceLevel.includes("preprint_or_unclear")) {
    penalty += weights.protocol_or_unclear;
  }

  if (!article.abstract) {
    penalty += weights.missing_abstract;
  }

  if (containsAny(title, ["correction", "erratum", "response to", "reply to", "comment on", "letter to", "editorial"])) {
    penalty += weights.editorial_noise;
  }

  return penalty;
}

function calculateClinicalDirectness(article = {}, intent = {}) {
  const title = normalizeText(article.title);
  const abstract = normalizeText(article.abstract);
  const text = `${title} ${abstract}`;
  const weights = RANKING_WEIGHTS.directness;
  let score = 0;
  const reasons = [];

  const conditionTerms = getConditionTerms(intent);
  const conditionMatch = getConditionMatchDetails(article, intent);

  const exerciseTerms = [
    normalizeText(intent.intervention),
    "therapeutic exercise",
    "exercise therapy",
    "exercise intervention",
    "exercise-based intervention",
    "exercise program",
    "exercise programme",
    "pilates",
    "yoga",
    "motor control",
    "stabilization",
    "stabilisation",
    "core stability",
    "strengthening",
    "resistance training",
    "rehabilitation",
  ].filter(Boolean);

  const directOutcomeTerms = [
    "effectiveness",
    "efficacy",
    "effects of exercise",
    "exercise intervention for",
    "exercise therapy for",
    "pain intensity",
    "disability",
    "physical function",
    "mobility",
    "quality of life",
    "best evidence rehabilitation",
    "network meta-analysis",
  ];

  const titleHasCondition = conditionTerms.some((term) => title.includes(term));
  const titleHasExercise = exerciseTerms.some((term) => title.includes(term));
  const titleHasDirectOutcome = directOutcomeTerms.some((term) => title.includes(term));
  const hasCondition = conditionMatch.hasTargetMatch;
  const hasExercise = exerciseTerms.some((term) => text.includes(term));
  const hasDirectOutcome = directOutcomeTerms.some((term) => text.includes(term));

  if (hasCondition && hasExercise) {
    score += weights.condition_and_intervention;
    reasons.push("Tema clínico central: condición + ejercicio");
  }

  if (titleHasCondition && titleHasExercise) {
    score += weights.title_condition_and_intervention;
    reasons.push("Título coincide con condición e intervención");
  }

  if (hasDirectOutcome) {
    score += weights.direct_clinical_outcome;
    reasons.push("Evalúa efectividad clínica directa");
  }

  if (title.includes("network meta-analysis")) {
    score += weights.network_meta_analysis;
    reasons.push("Compara múltiples intervenciones de ejercicio");
  }

  if (titleHasCondition && titleHasExercise && titleHasDirectOutcome) {
    score += weights.title_answers_question;
    reasons.push("El título responde directamente la pregunta clínica");
  }

  if (article.abstract && hasCondition && hasExercise && hasDirectOutcome) {
    score += weights.abstract_with_direct_results;
    reasons.push("Resumen con resultados clínicos relevantes");
  }

  const secondaryTitleTerms = [
    "adherence",
    "cost-effectiveness",
    "cost effectiveness",
    "economic evaluation",
    "cost-utility",
    "implementation",
    "feasibility",
  ];

  const secondaryAbstractTerms = [
    "cost-effectiveness",
    "cost effectiveness",
    "economic evaluation",
    "cost-utility",
    "feasibility study",
  ];

  if (containsAny(title, secondaryTitleTerms)) {
    score -= weights.secondary_focus_title_penalty;
    reasons.push("Tema secundario frente a efectividad clínica directa");
  } else if (containsAny(abstract, secondaryAbstractTerms)) {
    score -= weights.secondary_focus_abstract_penalty;
    reasons.push("Incluye tema secundario");
  }

  if (isLikelyProtocol(article)) {
    score -= weights.protocol_penalty;
    reasons.push("Protocolo: evidencia aún no completada");
  }

  if (containsAny(text, ["transcranial direct current stimulation", "tdcs"])) {
    score -= weights.combined_non_physio_penalty;
    reasons.push("Intervención combinada/no principalmente fisioterapéutica");
  }

  if (hasAdultIntent(intent) && containsAny(title, ["children", "adolescents", "pediatric", "paediatric"])) {
    score -= weights.adult_population_mismatch_penalty;
    reasons.push("Población menos directa para búsqueda en adultos");
  }

  if (!hasOlderAdultIntent(intent) && containsAny(title, ["elderly", "older adults", "aged"])) {
    score -= weights.older_adult_specific_penalty;
    reasons.push("Población específica: adultos mayores");
  }

  if (
    !conditionMatch.hasTargetMatch &&
    conditionMatch.hasCompetingTitleCondition
  ) {
    score -= weights.competing_condition_penalty;
    reasons.push("El título se centra en una condición clínica diferente");
  }

  return {
    score,
    reasons,
    condition_match: conditionMatch,
  };
}

function rankArticles(articles, intent = {}) {
  const nowYear = new Date().getFullYear();
  const dynamicConditionTerms = getConditionTerms(intent);
  const retrievalWeights = RANKING_WEIGHTS.retrieval_relevance;
  const blend = RANKING_WEIGHTS.reading_priority_blend;

  return articles
    .map((rawArticle) => {
      const article = enrichEvidenceMetadata(rawArticle, intent);
      let score = 0;
      const reasons = [];

      const typeScore = studyTypeScore(article);
      score += typeScore;

      if (article.evidence_level_rank >= 7) {
        reasons.push(`Nivel de evidencia: ${article.evidence_level_label_es}`);
      }

      const trustedSource = calculateTrustedSourceBoost(article);
      if (trustedSource.score > 0) {
        score += trustedSource.score;
        reasons.push(trustedSource.reason);
      }

      const directness = calculateClinicalDirectness(article, intent);
      score += directness.score;
      reasons.push(...directness.reasons);

      if (article.physiotherapy_relevance_score) {
        score += article.physiotherapy_relevance_score;

        if (article.physiotherapy_relevance_score >= 8) {
          reasons.push("Relevante para fisioterapia/rehabilitación");
        }
      }

      if (article.year) {
        const age = Math.max(0, nowYear - article.year);
        const recencyScore = Math.max(
          0,
          retrievalWeights.recency_max_bonus - age * retrievalWeights.recency_decay_per_year
        );
        score += recencyScore;

        if (recencyScore >= 10) {
          reasons.push("Publicación reciente");
        }
      }

      if (article.abstract) {
        score += retrievalWeights.abstract_available_bonus;
        reasons.push("Tiene resumen disponible");
      } else {
        score -= retrievalWeights.missing_abstract_penalty;
        reasons.push("Metadata limitada: sin resumen");
      }

      if (article.open_access) {
        score += retrievalWeights.open_access_bonus;
        reasons.push("Acceso abierto");
      }

      const combined = `${article.title || ""} ${article.abstract || ""}`;

      for (const term of intent.search_terms || []) {
        if (textIncludes(combined, term)) {
          score += retrievalWeights.search_term_match_bonus;
        }
      }

      if (dynamicConditionTerms.some((term) => textIncludes(combined, term))) {
        score += retrievalWeights.condition_match_bonus;
        reasons.push("Coincide con la condición");
      }

      if (intent.intervention && textIncludes(combined, intent.intervention)) {
        score += retrievalWeights.intervention_match_bonus;
        reasons.push("Coincide con la intervención");
      }

      if (intent.population && textIncludes(combined, intent.population)) {
        score += retrievalWeights.population_match_bonus;
        reasons.push("Coincide con la población");
      }

      const scoringInput = {
        ...article,
        trusted_source_label: trustedSource.source_label,
        trusted_source_score: trustedSource.score,
      };

      const evidencePriority = calculateOpenPhysioEvidenceScore(scoringInput);
      const queryRelevance = calculateQueryRelevanceScore(scoringInput, intent);
      const readingPriorityPenalty = calculateReadingPriorityPenalty(article);
      const readingPriorityScore = Number(Math.max(0, (
        queryRelevance.query_relevance_score * blend.query_relevance +
        evidencePriority.openphysio_evidence_score * blend.article_quality -
        readingPriorityPenalty
      )).toFixed(2));

      return {
        ...article,
        relevance_score: Number(score.toFixed(2)),
        ranking_reason: reasons.join("; "),
        trusted_source_label: trustedSource.source_label,
        trusted_source_score: trustedSource.score,
        condition_match: directness.condition_match,
        ...evidencePriority,
        ...queryRelevance,
        reading_priority_score: readingPriorityScore,
        reading_priority_penalty: readingPriorityPenalty,
        ranking_algorithm_version: RANKING_ALGORITHM_VERSION,
        ranking_weights_version: RANKING_WEIGHTS_VERSION,
      };
    })
    .sort((a, b) => {
      const priorityDiff = (b.reading_priority_score || 0) - (a.reading_priority_score || 0);
      if (priorityDiff !== 0) return priorityDiff;

      const relevanceDiff = (b.query_relevance_score || 0) - (a.query_relevance_score || 0);
      if (relevanceDiff !== 0) return relevanceDiff;

      const evidenceDiff = (b.openphysio_evidence_score || 0) - (a.openphysio_evidence_score || 0);
      if (evidenceDiff !== 0) return evidenceDiff;

      return b.relevance_score - a.relevance_score;
    });
}

module.exports = {
  rankArticles,
  calculateClinicalDirectness,
  calculateReadingPriorityPenalty,
  isLikelyProtocol,
};
