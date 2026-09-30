// Shared clinical-question model used by Chat and Research.
//
// The intent parser (DeepSeek) proposes PICO fields and a question type; this
// module validates them, keeps unknown values as null instead of guessing,
// and adds a deterministic fallback for the question type and the comparator
// when the model leaves them empty. Nothing here is specific to a condition.

const { classifyConditionTerm } = require("./conditionHierarchy");

const QUESTION_TYPES = [
  "treatment",
  "comparison",
  "diagnosis",
  "prognosis",
  "progression",
  "interpretation",
  "safety",
  "return_to_sport",
  "general",
];

const EMPTY_VALUES = new Set(["", "null", "none", "unknown", "n/a", "na", "not specified", "unspecified", "no especificado", "desconocido"]);

function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cleanValue(value) {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const joined = value.map(cleanValue).filter(Boolean).join(", ");
    return joined || null;
  }
  const text = String(value).trim();
  return EMPTY_VALUES.has(text.toLowerCase()) ? null : text.slice(0, 200);
}

function cleanTerms(value, limit = 6) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return Array.from(
    new Set(items.map(cleanValue).filter(Boolean).map((term) => term.slice(0, 80)))
  ).slice(0, limit);
}

// "A vs B", "A versus B", "A compared with B", "¿A o B?", "A frente a B".
const COMPARISON_PATTERNS = [
  /\b(?:vs\.?|versus|compared (?:with|to)|comparison|comparad[oa]s? (?:con|a)|frente a|en comparacion con|head[- ]to[- ]head)\b/,
  /\b(?:mejor|better|superior|more effective|mas eficaz|mas efectiv[oa])\b.*\b(?:o|or|que|than)\b/,
  /\b(?:es mejor|which is better|what is better|cual es mejor)\b/,
];

const TYPE_PATTERNS = [
  ["safety", /\b(?:red flags?|banderas? rojas?|contraindicat\w*|contraindicaci\w*|safe(?:ty)?|seguridad|segur[oa]|riesgos? del tratamiento|adverse|adversos?|precaucion\w*|precautions?)\b/],
  ["return_to_sport", /\b(?:return to (?:sport|play|running|competition)|retorno (?:al|a la) (?:deporte|competicion|carrera|actividad deportiva)|volver (?:al|a) (?:deporte|correr|competir|jugar)|rts)\b/],
  ["diagnosis", /\b(?:diagnos\w*|accuracy|precision diagnostica|sensitivity|sensibilidad|specificity|especificidad|clinical tests?|pruebas? clinicas?|tests? clinicos?|screening|cribado|assessment tools?|evaluacion clinica|como evaluo|how to assess|examinacion)\b/],
  ["prognosis", /\b(?:prognos\w*|pronostic\w*|natural history|historia natural|recovery time|tiempo de recuperacion|risk of (?:chronic|recurrence|persistent)|riesgo de (?:cronic|recurren|persisten)\w*|predict\w*|predictores?|chronic ankle instability after|evolucion esperada)\b/],
  ["progression", /\b(?:dos(?:e|is|age|ificacion)|dosificacion|volumen|volume|intensity|intensidad|frequency|frecuencia|sets?|series|repetitions?|repeticiones|progress(?:ion|ar|arias|o)?\w*|how much|cuanto|cuantas)\b/],
  ["interpretation", /\b(?:interpret\w*|what does it mean|que significa|como leo|how should i read|significado)\b/],
];

function detectQuestionType(text = "", { comparator = null } = {}) {
  const normalized = normalizeText(text);
  if (comparator || COMPARISON_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "comparison";
  }
  for (const [type, pattern] of TYPE_PATTERNS) {
    if (pattern.test(normalized)) return type;
  }
  if (/\b(?:treat\w*|tratamiento|tratar|exercis\w*|ejercicio\w*|therap\w*|terapia|intervention|intervencion|manage\w*|manejo|rehab\w*|effective|eficaz|efectiv\w*|recomienda|recommend\w*)\b/.test(normalized)) {
    return "treatment";
  }
  return "general";
}

// Splits "heavy slow resistance versus eccentric training" into two arms.
function splitComparison(text = "") {
  const match = String(text || "").match(
    /(.+?)\s+(?:vs\.?|versus|compared (?:with|to)|frente a|comparad[oa] con)\s+(.+)/i
  );
  if (!match) return null;
  return { intervention: match[1].trim(), comparator: match[2].trim() };
}

// Chat follow-ups reach the parser with earlier messages prepended; only the
// latest question decides the question type.
function latestQuestion(query = "") {
  const text = String(query || "");
  const marker = text.lastIndexOf("Latest question:");
  return marker >= 0 ? text.slice(marker + "Latest question:".length).trim() : text;
}

function normalizeClinicalQuestion(parsed = {}, query = "") {
  const intent = { ...(parsed || {}) };
  for (const field of ["condition", "body_region", "intervention", "population", "outcome", "comparator"]) {
    intent[field] = cleanValue(intent[field]);
  }
  intent.condition_terms = cleanTerms(intent.condition_terms);
  // Condition terms keep synonyms (and terms unknown to the hierarchy),
  // broader parents, narrower subtypes and related or framed co-existing
  // conditions: clinicalMatch caps those relations below direct. A sibling
  // or an unframed condition of another family added by the parser is not
  // the same diagnosis and is dropped; every term stays in the trace.
  if (intent.condition) {
    const relations = Object.fromEntries(
      intent.condition_terms.map((term) => [term, classifyConditionTerm(term, intent)])
    );
    intent.condition_term_relations = relations;
    intent.condition_terms = intent.condition_terms.filter((term) =>
      ["synonym", "parent", "child", "related", "component"].includes(relations[term])
    );
  }
  intent.intervention_terms = cleanTerms(intent.intervention_terms);
  intent.comparator_terms = cleanTerms(intent.comparator_terms);
  intent.context_used = intent.context_used === true;

  if (!intent.comparator && intent.intervention) {
    const split = splitComparison(intent.intervention);
    if (split) {
      intent.intervention = split.intervention;
      intent.comparator = split.comparator;
    }
  }

  const declared = String(intent.question_type || "").toLowerCase().trim();
  const detected = detectQuestionType(
    [latestQuestion(query), intent.normalized_query].filter(Boolean).join(" "),
    { comparator: intent.comparator }
  );
  intent.question_type = QUESTION_TYPES.includes(declared) ? declared : detected;
  // A comparison needs two arms; an explicit comparator makes it one.
  if (intent.comparator && intent.intervention) intent.question_type = "comparison";
  if (intent.question_type === "comparison" && (!intent.comparator || !intent.intervention)) {
    intent.question_type = detected === "comparison" ? "comparison" : detected;
  }
  intent.question_type_source = QUESTION_TYPES.includes(declared) ? "parser" : "rules";

  return intent;
}

module.exports = {
  QUESTION_TYPES,
  normalizeText,
  cleanValue,
  detectQuestionType,
  splitComparison,
  normalizeClinicalQuestion,
};
