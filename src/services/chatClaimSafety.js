function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const PRECISE_UNCITED_TERMS = [
  "international headache society",
  "ihs criteria",
  "unilateral without side shift",
  "trigger point",
  "punto gatillo",
  "vascular",
  "vertebral artery",
  "carotid artery",
  "arteria vertebral",
  "arteria carotida",
  "high velocity",
  "alta velocidad",
  "manipulation",
  "manipulacion",
  "instability",
  "inestabilidad",
  "contraindication",
  "contraindicacion",
  "diagnostic criterion",
  "criterio diagnostico",
  "specific test",
  "prueba especifica",
  "positive test",
  "test positivo",
];

const GENERIC_ASSESSMENT_TERMS = [
  "irritability",
  "irritabilidad",
  "symptom behavior",
  "comportamiento de los sintomas",
  "load tolerance",
  "tolerancia a la carga",
  "function",
  "funcion",
  "goals",
  "objetivos",
  "comorbidities",
  "comorbilidades",
  "preferences",
  "preferencias",
  "adherence",
  "adherencia",
  "history",
  "historia clinica",
  "physical examination",
  "examen fisico",
  "red flags",
  "banderas rojas",
  "signals of alarm",
  "senales de alarma",
];

const GENERIC_PRECAUTION_TERMS = [
  "evidence is limited",
  "evidence remains uncertain",
  "limited evidence",
  "la evidencia es limitada",
  "la evidencia sigue siendo incierta",
  "incertidumbre",
  "individual assessment",
  "evaluacion individual",
  "review of the original sources",
  "revision de las fuentes originales",
];

function hasSource(item = {}) {
  return Array.isArray(item.source_indices) && item.source_indices.length > 0;
}

function containsAny(text, terms) {
  const normalized = normalizeText(text);
  return terms.some((term) => normalized.includes(normalizeText(term)));
}

function isPreciseUncitedClaim(item = {}) {
  return !hasSource(item) && containsAny(item.text, PRECISE_UNCITED_TERMS);
}

function cleanSpacing(value = "") {
  return String(value || "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function sanitizeUncitedAssessmentText(item = {}, language = "es") {
  if (hasSource(item)) return { ...item };

  let text = String(item.text || "");
  text = text
    .replace(
      /\s*\((?:p\.?\s*ej\.?|e\.?g\.?)?\s*,?\s*(?:oswestry|roland[-– ]morris)[^)]*\)/gi,
      ""
    )
    .replace(/\b(?:oswestry|roland[-– ]morris)\b/gi, "")
    .replace(/\s*\(\s*>?\s*\d+\s*(?:semanas?|weeks?)\s*\)/gi, "")
    .replace(/\b(?:cuestionarios?|questionnaires?)\s+validados?\s*[,;:]?\s*$/gi, "")
    .replace(/\bvalidated\s+questionnaires?\s*[,;:]?\s*$/gi, "");

  text = cleanSpacing(text);
  if (!text) {
    text =
      language === "en"
        ? "Assess functional impact and load tolerance using measures appropriate to the clinical context."
        : "Valora el impacto funcional y la tolerancia a la carga con medidas apropiadas para el contexto clínico.";
  }

  return { ...item, text };
}

function sanitizeClinicalApplicationItems(items = [], language = "es") {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      let text = String(item?.text || "").trim();

      if (language === "en") {
        text = text
          .replace(/^Prescribe\s+/i, "Consider ")
          .replace(/\bas effective options\b/gi, "as possible options");
      } else {
        text = text
          .replace(/^Prescribir\s+/i, "Considerar ")
          .replace(/\bcomo opciones efectivas\b/gi, "como opciones posibles");
      }

      return { ...item, text: cleanSpacing(text) };
    })
    .filter((item) => item.text)
    .slice(0, 6);
}

function sanitizeAssessmentItems(items = [], language = "es") {
  const normalizedItems = (Array.isArray(items) ? items : []).map((item) =>
    sanitizeUncitedAssessmentText(item, language)
  );

  const safe = normalizedItems.filter((item) => {
    if (hasSource(item)) return true;
    if (isPreciseUncitedClaim(item)) return false;
    return containsAny(item.text, GENERIC_ASSESSMENT_TERMS);
  });

  if (safe.length) return safe.slice(0, 5);

  return [
    {
      text:
        language === "en"
          ? "Before selecting an intervention, assess symptom irritability, functional impact, load tolerance, goals, relevant comorbidities, and warning signs through a complete history and physical examination."
          : "Antes de seleccionar una intervención, valora la irritabilidad, el impacto funcional, la tolerancia a la carga, los objetivos, las comorbilidades relevantes y las señales de alarma mediante una historia clínica y un examen físico completos.",
      source_indices: [],
    },
  ];
}

function sanitizePrecautionItems(items = [], confidence = {}, language = "es") {
  const safe = items.filter((item) => {
    if (hasSource(item)) return true;
    if (isPreciseUncitedClaim(item)) return false;
    return containsAny(item.text, GENERIC_PRECAUTION_TERMS);
  });

  if (confidence.level_key === "limited") {
    const limitedEvidenceText =
      language === "en"
        ? "The retrieved evidence is limited; do not present a specific intervention as superior without reviewing the original studies and the individual clinical context."
        : "La evidencia recuperada es limitada; no presentes una intervención específica como superior sin revisar los estudios originales y el contexto clínico individual.";

    if (!safe.some((item) => normalizeText(item.text).includes("evidencia"))) {
      safe.push({ text: limitedEvidenceText, source_indices: [] });
    }
  }

  return safe.slice(0, 5);
}

function sanitizeStructuredChatResponse(
  structured = {},
  { language = "es", confidence = structured.confidence || {} } = {}
) {
  return {
    ...structured,
    clinical_application: sanitizeClinicalApplicationItems(
      structured.clinical_application || [],
      language
    ),
    assessment_considerations: sanitizeAssessmentItems(
      structured.assessment_considerations || [],
      language
    ),
    precautions: sanitizePrecautionItems(
      structured.precautions || [],
      confidence,
      language
    ),
    confidence,
  };
}

module.exports = {
  isPreciseUncitedClaim,
  sanitizeUncitedAssessmentText,
  sanitizeClinicalApplicationItems,
  sanitizeAssessmentItems,
  sanitizePrecautionItems,
  sanitizeStructuredChatResponse,
};
