const {
  refineStructuredResearchAnswer,
} = require("./researchAnswerSafety");

function normalize(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function hasClinicalRelevanceClaim(text = "") {
  const normalized = normalize(text);
  return (
    normalized.includes("clinicamente relevante") ||
    normalized.includes("clinicamente relevantes") ||
    normalized.includes("clinically relevant")
  );
}

function hasManualTherapyIncrementClaim(text = "") {
  const normalized = normalize(text);
  const mentionsManualTherapy =
    normalized.includes("terapia manual") ||
    normalized.includes("manual therapy");
  const claimsIncrement = [
    "mejoras adicionales",
    "beneficios adicionales",
    "additional improvements",
    "additional benefits",
    "provide additional",
  ].some((signal) => normalized.includes(signal));

  return mentionsManualTherapy && claimsIncrement;
}

function cautiousExerciseText(language = "es") {
  return language === "en"
    ? "Pilates, yoga, tai chi, stabilization, and motor-control exercise may improve pain or disability compared with usual care or no exercise, although effect magnitude and certainty vary across modalities."
    : "Pilates, yoga, tai chi, estabilización y control motor pueden mejorar el dolor o la discapacidad frente a la atención habitual o la ausencia de ejercicio, aunque la magnitud del beneficio y la certeza varían entre modalidades.";
}

function cautiousManualTherapyText(language = "es") {
  return language === "en"
    ? "Adding manual therapy to exercise may provide short-term benefit for some patients, although its incremental value and certainty vary across studies."
    : "Añadir terapia manual al ejercicio podría aportar beneficios a corto plazo en algunos pacientes, aunque su valor incremental y la certeza varían entre estudios.";
}

function sanitizeFinalClaim(item = {}, language = "es") {
  const text = String(item.text || "");

  if (hasManualTherapyIncrementClaim(text)) {
    return {
      ...item,
      text: cautiousManualTherapyText(language),
    };
  }

  if (hasClinicalRelevanceClaim(text)) {
    return {
      ...item,
      text: cautiousExerciseText(language),
    };
  }

  return item;
}

function refineStructuredResearchAnswerFinal(
  structured = {},
  confidence = {},
  articles = [],
  language = "es"
) {
  const base = refineStructuredResearchAnswer(
    structured,
    confidence,
    articles,
    language
  );
  const sanitizeList = (items) =>
    (Array.isArray(items) ? items : []).map((item) =>
      sanitizeFinalClaim(item, language)
    );

  return {
    structured: {
      ...base.structured,
      clinical_answer: sanitizeList(base.structured.clinical_answer),
      key_findings: sanitizeList(base.structured.key_findings),
      evidence_relationships: sanitizeList(
        base.structured.evidence_relationships
      ),
    },
    confidence: base.confidence,
  };
}

module.exports = {
  sanitizeFinalClaim,
  refineStructuredResearchAnswerFinal,
};
