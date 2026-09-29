// Section layout of a Chat answer by question type (P1.4).
//
// One shared JSON shape and one identity (answer -> evidence -> application
// and limits); only the order and titles of the sections change with the
// question type. Empty sections are omitted, so an answer is as long as the
// question needs.

const LABELS = {
  es: {
    answer: "Respuesta directa",
    evidence: "Qué muestra la evidencia",
    comparative: "Qué dice la evidencia comparativa",
    differences: "Diferencias relevantes",
    consider: "Qué considerar",
    findings: "Hallazgos relevantes",
    principles: "Principios",
    progress: "Cómo progresar",
    monitor: "Qué monitorizar",
    prognosis: "Qué dice la evidencia sobre la evolución",
    factors: "Factores a valorar",
    criteria: "Criterios con respaldo",
    observe: "Qué observar",
    apply: "Aplicación clínica",
    beforeApplying: "Antes de aplicarlo",
    limits: "Limitaciones",
    safetyLimits: "Seguridad y limitaciones",
    safety: "Seguridad",
  },
  en: {
    answer: "Direct answer",
    evidence: "What the evidence shows",
    comparative: "What the comparative evidence shows",
    differences: "Relevant differences",
    consider: "What to consider",
    findings: "Relevant findings",
    principles: "Principles",
    progress: "How to progress",
    monitor: "What to monitor",
    prognosis: "What the evidence shows about the course",
    factors: "Factors to assess",
    criteria: "Supported criteria",
    observe: "What to watch for",
    apply: "Clinical application",
    beforeApplying: "Before applying it",
    limits: "Limitations",
    safetyLimits: "Safety and limitations",
    safety: "Safety",
  },
};

// [field, label key] in display order. brief_answer is always first.
const LAYOUTS = {
  treatment: [["evidence_points", "evidence"], ["clinical_application", "apply"], ["assessment_considerations", "beforeApplying"], ["precautions", "limits"]],
  comparison: [["evidence_points", "comparative"], ["clinical_application", "differences"], ["assessment_considerations", "consider"], ["precautions", "limits"]],
  diagnosis: [["assessment_considerations", "consider"], ["evidence_points", "findings"], ["clinical_application", "apply"], ["precautions", "safetyLimits"]],
  progression: [["evidence_points", "principles"], ["clinical_application", "progress"], ["assessment_considerations", "monitor"], ["precautions", "limits"]],
  prognosis: [["evidence_points", "prognosis"], ["assessment_considerations", "factors"], ["clinical_application", "apply"], ["precautions", "limits"]],
  return_to_sport: [["evidence_points", "criteria"], ["clinical_application", "apply"], ["assessment_considerations", "monitor"], ["precautions", "limits"]],
  interpretation: [["evidence_points", "evidence"], ["assessment_considerations", "observe"], ["clinical_application", "apply"], ["precautions", "limits"]],
  // Safety: the safety statement is already first in brief_answer; no
  // routine application section.
  safety: [["precautions", "safety"], ["evidence_points", "evidence"], ["assessment_considerations", "consider"]],
};
LAYOUTS.general = LAYOUTS.treatment;

function chatLayout(questionType = "general", { redFlag = false } = {}) {
  if (redFlag) return LAYOUTS.safety;
  return LAYOUTS[questionType] || LAYOUTS.general;
}

function sectionLabel(key, language = "es") {
  return (LABELS[language === "en" ? "en" : "es"] || LABELS.es)[key];
}

module.exports = {
  LAYOUTS,
  chatLayout,
  sectionLabel,
};
