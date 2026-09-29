// Answer used when the search could not be completed for technical reasons
// (P2.1): important providers failed or timed out and nothing usable was
// retrieved. It never says that evidence does not exist, because the search
// was incomplete. It is a degraded operation: 0 units, no shared cache, and
// it does not count towards the user's degraded-answer cooldown.

const TEXT = {
  es: "No pudimos consultar todas las bases de datos científicas en este momento, así que no es posible saber si existe evidencia para esta pregunta. Esta consulta no se ha descontado de tu plan; inténtalo de nuevo en unos minutos.",
  en: "We couldn't reach all the scientific databases right now, so it isn't possible to tell whether evidence exists for this question. This query was not counted against your plan; please try again in a few minutes.",
};

const CONFIDENCE = {
  es: { level: "Limitado", rationale: "La búsqueda no se completó por un problema técnico con las bases de datos." },
  en: { level: "Limited", rationale: "The search was not completed because of a technical problem with the databases." },
};

function retrievalDegradedText(language = "es") {
  return TEXT[language === "en" ? "en" : "es"];
}

function retrievalDegradedConfidence(language = "es") {
  const c = CONFIDENCE[language === "en" ? "en" : "es"];
  return { level: c.level, level_key: "limited", score: 10, rationale: c.rationale, metrics: { retrieval_degraded: true } };
}

function buildRetrievalDegradedChatStructure(language = "es") {
  return {
    brief_answer: [{ text: retrievalDegradedText(language), source_indices: [] }],
    evidence_points: [],
    evidence_relationships: [],
    clinical_application: [],
    assessment_considerations: [],
    precautions: [],
    confidence: retrievalDegradedConfidence(language),
    follow_up_options: [],
    retrieval_degraded: true,
    degraded: true,
  };
}

function buildRetrievalDegradedResearchAnswer(language = "es") {
  const confidence = retrievalDegradedConfidence(language);
  return {
    structured: {
      clinical_answer: [],
      key_findings: [],
      evidence_relationships: [],
      consistency_level: "uncertain",
      reading_path: [],
      uncertainties: [],
      methodological_caution: retrievalDegradedText(language),
      confidence,
      retrieval_degraded: true,
    },
    confidence,
    languageGuard: { version: "1.0.0", requested_language: language, corrected: false, fallback_used: false },
    degraded: true,
    retrievalDegraded: true,
  };
}

// Compact, user-safe view of the retrieval outcome for API responses.
function publicRetrieval(retrieval) {
  if (!retrieval) return null;
  return {
    status: retrieval.status,
    important_failure: Boolean(retrieval.important_failure),
    failed_providers: retrieval.failed_providers || [],
    providers: (retrieval.providers || []).map((p) => ({
      source: p.source,
      status: p.status,
      requests: p.requests,
      retrieved_count: p.retrieved_count,
      duration_ms: p.duration_ms,
      timed_out: p.timed_out,
      budget_ms: p.budget_ms,
    })),
  };
}

module.exports = {
  retrievalDegradedText,
  buildRetrievalDegradedChatStructure,
  buildRetrievalDegradedResearchAnswer,
  publicRetrieval,
};
