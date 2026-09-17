const SPANISH_SIGNALS = new Map([
  ["que", 2],
  ["cual", 2],
  ["como", 1],
  ["para", 1],
  ["con", 1],
  ["del", 1],
  ["los", 1],
  ["las", 1],
  ["una", 1],
  ["dolor", 2],
  ["paciente", 2],
  ["ejercicio", 2],
  ["ejercicios", 2],
  ["tratamiento", 2],
  ["fisioterapia", 2],
  ["rehabilitacion", 2],
  ["cronico", 1],
  ["cronica", 1],
  ["evidencia", 1],
  ["lesion", 1],
  ["rodilla", 1],
  ["hombro", 1],
  ["cervical", 1],
  ["lumbar", 1],
]);

const ENGLISH_SIGNALS = new Map([
  ["what", 2],
  ["which", 2],
  ["how", 2],
  ["for", 1],
  ["with", 1],
  ["the", 1],
  ["and", 1],
  ["pain", 2],
  ["patient", 2],
  ["exercise", 2],
  ["exercises", 2],
  ["treatment", 2],
  ["physiotherapy", 2],
  ["physical", 1],
  ["therapy", 1],
  ["rehabilitation", 2],
  ["chronic", 1],
  ["evidence", 1],
  ["injury", 1],
  ["knee", 1],
  ["shoulder", 1],
  ["neck", 1],
  ["back", 1],
]);

function normalizeLanguageCode(value) {
  const language = String(value || "").trim().toLowerCase();
  if (language.startsWith("es")) return "es";
  if (language.startsWith("en")) return "en";
  return null;
}

function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreLanguage(value = "") {
  const original = String(value || "");
  const tokens = normalizeText(original).split(" ").filter(Boolean);
  let es = /[áéíóúñ¿¡]/i.test(original) ? 3 : 0;
  let en = 0;

  for (const token of tokens) {
    es += SPANISH_SIGNALS.get(token) || 0;
    en += ENGLISH_SIGNALS.get(token) || 0;
  }

  return { es, en, tokenCount: tokens.length };
}

function detectQueryLanguage(query = "") {
  const score = scoreLanguage(query);
  if (score.es >= 2 && score.es >= score.en + 1) return "es";
  if (score.en >= 2 && score.en >= score.es + 1) return "en";
  return null;
}

function resolveResearchResponseLanguage({
  query = "",
  requestedLanguage = null,
  intent = {},
} = {}) {
  return (
    detectQueryLanguage(query) ||
    normalizeLanguageCode(requestedLanguage) ||
    normalizeLanguageCode(intent.language) ||
    "en"
  );
}

function collectResearchNarrativeFields(structured = {}) {
  const fields = [];

  (structured.key_findings || []).forEach((item, index) => {
    if (item?.text) {
      fields.push({ id: `key_findings.${index}`, text: String(item.text) });
    }
  });
  (structured.evidence_relationships || []).forEach((item, index) => {
    if (item?.text) {
      fields.push({
        id: `evidence_relationships.${index}`,
        text: String(item.text),
      });
    }
  });
  (structured.uncertainties || []).forEach((item, index) => {
    if (item) {
      fields.push({ id: `uncertainties.${index}`, text: String(item) });
    }
  });
  if (structured.methodological_caution) {
    fields.push({
      id: "methodological_caution",
      text: String(structured.methodological_caution),
    });
  }

  return fields;
}

function isResearchNarrativeLanguageCompliant(structured = {}, language) {
  const expected = normalizeLanguageCode(language);
  if (!expected) return true;

  const text = collectResearchNarrativeFields(structured)
    .map((field) => field.text)
    .join(" ");
  const score = scoreLanguage(text);
  if (score.tokenCount < 4) return true;

  const expectedScore = score[expected];
  const otherScore = score[expected === "es" ? "en" : "es"];
  return expectedScore >= 2 && expectedScore >= otherScore;
}

function applyResearchNarrativeTranslations(structured = {}, translations = []) {
  const byId = new Map(
    (Array.isArray(translations) ? translations : [])
      .map((item) => [String(item?.id || ""), String(item?.text || "").trim()])
      .filter(([id, text]) => id && text)
  );
  const translatedText = (id, fallback) => byId.get(id) || fallback;

  return {
    ...structured,
    key_findings: (structured.key_findings || []).map((item, index) => ({
      ...item,
      text: translatedText(`key_findings.${index}`, item.text),
    })),
    evidence_relationships: (structured.evidence_relationships || []).map(
      (item, index) => ({
        ...item,
        text: translatedText(`evidence_relationships.${index}`, item.text),
      })
    ),
    uncertainties: (structured.uncertainties || []).map((item, index) =>
      translatedText(`uncertainties.${index}`, item)
    ),
    methodological_caution: translatedText(
      "methodological_caution",
      structured.methodological_caution
    ),
  };
}

module.exports = {
  applyResearchNarrativeTranslations,
  collectResearchNarrativeFields,
  detectQueryLanguage,
  isResearchNarrativeLanguageCompliant,
  normalizeLanguageCode,
  resolveResearchResponseLanguage,
  scoreLanguage,
};
