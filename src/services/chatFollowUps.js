// Follow-up suggestions from what the answer actually left open (P1.5):
// no head-to-head comparison, no dosage, diagnostic uncertainty, indirect or
// limited evidence... Each suggestion only proposes a next search; none
// states a clinical fact. Only the ones that apply: 0 to 3, never padded.

const MAX_FOLLOW_UPS = 3;

const DOSE_TERMS = /\b(?:series|repeticiones|semanas|veces|minutos|dosis|dosificaci\w+|frecuencia|intensidad|sets?|reps?|repetitions|weeks|minutes|times per|dose|dosage|frequency|intensity|\d+\s*(?:x|×)\s*\d+|%\s*(?:1rm|rm))\b/i;

const TEXT = {
  es: {
    separate: ["Evidencia de cada opción", "¿Quieres que compare por separado la evidencia de cada intervención?"],
    h2hDetail: ["Diferencias entre estudios", "¿Quieres revisar en qué pacientes y resultados coinciden o difieren los estudios comparativos?"],
    dose: ["Revisar la dosificación", "¿Quieres que revise la dosificación utilizada en los estudios?"],
    differentiate: ["Diferenciar el cuadro", "¿Quieres revisar qué hallazgos clínicos ayudan a diferenciar las causas más probables de estos síntomas?"],
    accuracy: ["Precisión de las pruebas", "¿Quieres revisar la sensibilidad y especificidad de cada prueba en los estudios?"],
    prognosis: ["Factores pronósticos", "¿Quieres revisar qué factores se asocian a una peor evolución en los estudios?"],
    progression: ["Criterios de progresión", "¿Quieres revisar qué criterios usan los estudios para progresar la carga?"],
    rts: ["Pruebas de retorno", "¿Quieres revisar qué pruebas funcionales usan los estudios como criterio de retorno?"],
    broaden: ["Ampliar en Research", "¿Quieres ampliar la búsqueda en Research para ver más estudios sobre esta pregunta?"],
    referral: ["Criterios de derivación", "¿Quieres revisar qué signos justifican una derivación médica urgente?"],
  },
  en: {
    separate: ["Evidence for each option", "Should I review the evidence for each intervention separately?"],
    h2hDetail: ["Differences between studies", "Should I review in which patients and outcomes the comparative studies agree or differ?"],
    dose: ["Review the dosage", "Should I review the dosage used in the studies?"],
    differentiate: ["Differentiate the presentation", "Should I review which clinical findings help differentiate the most likely causes of these symptoms?"],
    accuracy: ["Test accuracy", "Should I review the sensitivity and specificity of each test in the studies?"],
    prognosis: ["Prognostic factors", "Should I review which factors are associated with a worse course in the studies?"],
    progression: ["Progression criteria", "Should I review which criteria the studies use to progress load?"],
    rts: ["Return tests", "Should I review which functional tests the studies use as return criteria?"],
    broaden: ["Broaden in Research", "Should I broaden the search in Research to see more studies on this question?"],
    referral: ["Referral criteria", "Should I review which signs justify urgent medical referral?"],
  },
};

// A symptom or clinical finding described by the clinician: only then is a
// differential-diagnosis follow-up meaningful. Performance, prevention,
// intervention or comparison questions about healthy people have none.
const SYMPTOM_OR_FINDING = /\b(?:dolor\w*|duele|molestias?|s[ií]ntomas?|hinchaz[oó]n|inflamaci[oó]n|rigidez|debilidad|hormigueo|entumecimiento|parestesias?|chasquidos?|bloqueos?|inestabilidad|cojera|mareos?|v[eé]rtigo|pain\w*|aches?|sore\w*|symptoms?|swelling|swollen|stiffness|weakness|numbness|tingling|clicking|locking|instability|limp\w*|dizziness)\b/i;

function describesSymptoms(question = "") {
  return SYMPTOM_OR_FINDING.test(String(question || ""));
}

function answerText(structured = {}) {
  return ["brief_answer", "evidence_points", "clinical_application", "assessment_considerations"]
    .flatMap((field) => (structured[field] || []).map((item) => item.text || ""))
    .join(" ");
}

function buildGapFollowUps({
  question = "",
  intent = {},
  comparison = null,
  confidence = null,
  sufficiency = null,
  safety = null,
  structured = {},
  language = "es",
} = {}) {
  const t = TEXT[language === "en" ? "en" : "es"];
  const type = intent.question_type || "general";
  const keys = [];

  if (safety?.status === "red_flag") {
    keys.push("referral");
  } else {
    if (comparison?.requested) keys.push(comparison.direct ? "h2hDetail" : "separate");
    const insufficient = sufficiency?.status === "insufficient";
    // Differential diagnosis only when there is something to differentiate:
    // described symptoms or findings without an identified condition, or a
    // diagnostic question with symptoms.
    if (
      !intent.condition &&
      ["treatment", "general", "diagnosis"].includes(type) &&
      describesSymptoms(question)
    ) {
      keys.push("differentiate");
    }
    if (type === "diagnosis") keys.push("accuracy");
    if (type === "prognosis") keys.push("prognosis");
    // Dose and progression follow-ups make no sense when the evidence cannot
    // answer the main question.
    if (type === "progression" && !insufficient) keys.push("progression");
    if (type === "return_to_sport") keys.push("rts");
    if (
      !insufficient &&
      ["treatment", "comparison", "general"].includes(type) &&
      !DOSE_TERMS.test(answerText(structured))
    ) {
      keys.push("dose");
    }
    const weak =
      ["insufficient", "limited"].includes(sufficiency?.status) ||
      ["indirect", "limited", "conflicting"].includes(confidence?.level_key);
    if (weak) keys.push("broaden");
  }

  return Array.from(new Set(keys))
    .slice(0, MAX_FOLLOW_UPS)
    .map((key) => ({ label: t[key][0], prompt: t[key][1], gap: key }));
}

module.exports = {
  MAX_FOLLOW_UPS,
  buildGapFollowUps,
};
