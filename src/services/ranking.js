const { enrichEvidenceMetadata } = require("./evidenceLevel");
const { calculateTrustedSourceBoost } = require("./trustedSources");
const { calculateOpenPhysioEvidenceScore } = require("./evidenceScoring");

function studyTypeScore(article = {}) {
  const evidenceRank = Number(article.evidence_level_rank || 1);
  return evidenceRank * 12;
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

function calculateClinicalDirectness(article = {}, intent = {}) {
  const title = normalizeText(article.title);
  const abstract = normalizeText(article.abstract);
  const text = `${title} ${abstract}`;
  let score = 0;
  const reasons = [];

  const conditionTerms = [
    normalizeText(intent.condition),
    "chronic low back pain",
    "chronic nonspecific low back pain",
    "chronic non-specific low back pain",
    "nonspecific low back pain",
    "non-specific low back pain",
    "low back pain",
    "lumbar pain",
  ].filter(Boolean);

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

  const hasCondition = conditionTerms.some((term) => text.includes(term));
  const hasExercise = exerciseTerms.some((term) => text.includes(term));
  const hasDirectOutcome = directOutcomeTerms.some((term) => text.includes(term));

  if (hasCondition && hasExercise) {
    score += 18;
    reasons.push("Tema clínico central: condición + ejercicio");
  }

  if (title && conditionTerms.some((term) => title.includes(term)) && exerciseTerms.some((term) => title.includes(term))) {
    score += 14;
    reasons.push("Título coincide con condición e intervención");
  }

  if (hasDirectOutcome) {
    score += 12;
    reasons.push("Evalúa efectividad clínica directa");
  }

  if (title.includes("network meta-analysis")) {
    score += 12;
    reasons.push("Compara múltiples intervenciones de ejercicio");
  }

  if (title.includes("exercise intervention for patients with chronic low back pain")) {
    score += 10;
    reasons.push("Pregunta clínica principal en el título");
  }

  if (article.abstract && hasCondition && hasExercise && hasDirectOutcome) {
    score += 8;
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
    score -= 20;
    reasons.push("Tema secundario frente a efectividad clínica directa");
  } else if (containsAny(abstract, secondaryAbstractTerms)) {
    score -= 8;
    reasons.push("Incluye tema secundario");
  }

  if (isLikelyProtocol(article)) {
    score -= 45;
    reasons.push("Protocolo: evidencia aún no completada");
  }

  if (containsAny(text, ["transcranial direct current stimulation", "tdcs"])) {
    score -= 14;
    reasons.push("Intervención combinada/no principalmente fisioterapéutica");
  }

  if (hasAdultIntent(intent) && containsAny(title, ["children", "adolescents", "pediatric", "paediatric"])) {
    score -= 24;
    reasons.push("Población menos directa para búsqueda en adultos");
  }

  if (!hasOlderAdultIntent(intent) && containsAny(title, ["elderly", "older adults", "aged"])) {
    score -= 8;
    reasons.push("Población específica: adultos mayores");
  }

  if (
    containsAny(title, ["hip/knee osteoarthritis", "knee osteoarthritis", "hip osteoarthritis", "neck pain"]) &&
    !containsAny(normalizeText(intent.condition), ["osteoarthritis", "neck"])
  ) {
    score -= 10;
    reasons.push("Incluye condición adicional no principal");
  }

  return { score, reasons };
}

function rankArticles(articles, intent = {}) {
  const nowYear = new Date().getFullYear();

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
        const recencyScore = Math.max(0, 16 - age * 1.2);
        score += recencyScore;

        if (recencyScore >= 10) {
          reasons.push("Publicación reciente");
        }
      }

      if (article.abstract) {
        score += 12;
        reasons.push("Tiene resumen disponible");
      } else {
        score -= 24;
        reasons.push("Metadata limitada: sin resumen");
      }

      if (article.open_access) {
        score += 4;
        reasons.push("Acceso abierto");
      }

      const combined = `${article.title || ""} ${article.abstract || ""}`;

      for (const term of intent.search_terms || []) {
        if (textIncludes(combined, term)) {
          score += 3;
        }
      }

      if (intent.condition && textIncludes(combined, intent.condition)) {
        score += 14;
        reasons.push("Coincide con la condición");
      }

      if (intent.intervention && textIncludes(combined, intent.intervention)) {
        score += 14;
        reasons.push("Coincide con la intervención");
      }

      if (intent.population && textIncludes(combined, intent.population)) {
        score += 6;
        reasons.push("Coincide con la población");
      }

      const evidenceScoringInput = {
        ...article,
        trusted_source_label: trustedSource.source_label,
        trusted_source_score: trustedSource.score,
      };

      const evidencePriority = calculateOpenPhysioEvidenceScore(evidenceScoringInput, intent);

      return {
        ...article,
        relevance_score: Number(score.toFixed(2)),
        ranking_reason: reasons.join("; "),
        trusted_source_label: trustedSource.source_label,
        trusted_source_score: trustedSource.score,
        ...evidencePriority,
      };
    })
    .sort((a, b) => {
      const scoreDiff = (b.openphysio_evidence_score || 0) - (a.openphysio_evidence_score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return b.relevance_score - a.relevance_score;
    });
}

module.exports = { rankArticles };
