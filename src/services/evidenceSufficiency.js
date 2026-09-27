// Decides whether the evidence selected for a Chat answer can support an
// answer at all. When it cannot, Chat returns an explicit, deterministic
// "insufficient evidence" answer instead of asking the model to write a
// complete-looking synthesis from tangential sources.

const INSUFFICIENT_STATEMENT = {
  es: "La evidencia recuperada no permite responder esta pregunta con suficiente seguridad.",
  en: "The retrieved evidence does not allow this question to be answered with enough confidence.",
};

// An article can support the answer when it addresses the question directly
// or partially (same condition, related intervention or outcome). Tangential
// sources (same body region or a different condition) cannot.
function isUsableEvidence(article = {}) {
  const tier = article.clinical_match?.tier;
  if (tier) return tier === "direct" || tier === "partial";
  return ["direct", "complementary"].includes(article.clinical_directness);
}

function assessEvidenceSufficiency(articles = []) {
  const list = Array.isArray(articles) ? articles : [];
  const usable = list.filter(isUsableEvidence);
  const direct = list.filter((article) =>
    article.clinical_match?.tier
      ? article.clinical_match.tier === "direct"
      : article.clinical_directness === "direct"
  );

  let status = "sufficient";
  const reasons = [];
  if (!list.length) {
    status = "insufficient";
    reasons.push("no_evidence_retrieved");
  } else if (!usable.length) {
    status = "insufficient";
    reasons.push("only_tangential_evidence");
  } else if (!direct.length) {
    status = "limited";
    reasons.push("no_direct_evidence");
  }

  return {
    version: "1.0.0",
    status,
    reasons,
    article_count: list.length,
    usable_count: usable.length,
    direct_count: direct.length,
  };
}

function buildInsufficientEvidenceConfidence(language = "es") {
  const isEnglish = language === "en";
  return {
    level: isEnglish ? "Limited" : "Limitada",
    level_key: "limited",
    score: 15,
    rationale: isEnglish
      ? "No retrieved source addresses this question directly; the closest sources are tangential."
      : "Ninguna fuente recuperada aborda esta pregunta de forma directa; las más cercanas son tangenciales.",
    metrics: { insufficient_evidence: true },
  };
}

function buildInsufficientEvidenceStructure(articles = [], language = "es") {
  const isEnglish = language === "en";
  const indices = (Array.isArray(articles) ? articles : [])
    .slice(0, 4)
    .map((_, index) => index + 1);

  const brief = [{ text: INSUFFICIENT_STATEMENT[isEnglish ? "en" : "es"], source_indices: [] }];
  if (indices.length) {
    brief.push({
      text: isEnglish
        ? "The closest sources retrieved address related questions, not this one; their findings are not generalized to your question."
        : "Las fuentes más cercanas que se recuperaron abordan preguntas relacionadas, no esta; sus resultados no se generalizan a tu pregunta.",
      source_indices: indices,
    });
  }

  return {
    brief_answer: brief,
    evidence_relationships: [],
    clinical_application: [],
    assessment_considerations: [
      {
        text: isEnglish
          ? "Base the decision on the clinical assessment and the patient's response, and reformulate the question with the condition, intervention and outcome of interest, or broaden it in Research."
          : "Basa la decisión en la evaluación clínica y en la respuesta del paciente, y reformula la pregunta con la condición, la intervención y el resultado de interés, o amplíala en Research.",
        source_indices: [],
      },
    ],
    precautions: [],
    confidence: buildInsufficientEvidenceConfidence(language),
    insufficient_evidence: true,
  };
}

module.exports = {
  INSUFFICIENT_STATEMENT,
  isUsableEvidence,
  assessEvidenceSufficiency,
  buildInsufficientEvidenceConfidence,
  buildInsufficientEvidenceStructure,
};
