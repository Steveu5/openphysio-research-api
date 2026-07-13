function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function sortedSourceIndices(value = []) {
  return Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0)
    )
  ).sort((left, right) => left - right);
}

function removeUnsupportedPrecision(value = "", language = "es") {
  let text = String(value || "").trim();

  text = text.replace(
    /\s*\([^)]*\b\d+(?:[.,]\d+)?\s*(?:puntos?|points?|%|por ciento|percent)\b[^)]*\)/gi,
    ""
  );
  text = text.replace(
    /\bmejoras?\s+cl[ií]nicamente\s+(?:relevantes?|importantes?)\b/gi,
    language === "en" ? "improvements" : "mejoras"
  );
  text = text.replace(
    /\bclinically\s+(?:meaningful|important)\s+improvements?\b/gi,
    "improvements"
  );
  text = text.replace(/\s+([,.;:])/g, "$1").replace(/\s{2,}/g, " ").trim();

  return text;
}

function softenClinicalLanguage(value = "", language = "es") {
  let text = removeUnsupportedPrecision(value, language);

  if (language === "en") {
    text = text
      .replace(/^Prescribe\b/i, "Consider")
      .replace(/^Avoid passive interventions\b/i, "Do not rely exclusively on passive interventions")
      .replace(/\bproves?\b/gi, "suggests")
      .replace(/\bguarantees?\b/gi, "may support")
      .replace(
        /\b(?:show|shows|demonstrate|demonstrates|provide|provides)\s+significant\s+(?:benefits?|improvements?)\b/gi,
        "may improve some outcomes"
      )
      .replace(
        /\bsignificant\s+(?:benefits?|improvements?)\b/gi,
        "possible improvements"
      );
  } else {
    text = text
      .replace(/^Prescriba\b/i, "Considera")
      .replace(/^Evite intervenciones pasivas\b/i, "No dependas exclusivamente de intervenciones pasivas")
      .replace(/\bdemuestra\b/gi, "sugiere")
      .replace(/\bgarantiza\b/gi, "puede favorecer")
      .replace(
        /\b(?:muestran?|demuestran?|ofrecen?|producen?)\s+beneficios?\s+significativos?\b/gi,
        "pueden mejorar algunos resultados"
      )
      .replace(/\bbeneficios?\s+significativos?\b/gi, "posibles beneficios")
      .replace(/\bmejoras?\s+significativas?\b/gi, "posibles mejoras");
  }

  return text.trim();
}

function refineClaim(item = {}, language = "es") {
  return {
    ...item,
    text: softenClinicalLanguage(item.text, language),
    source_indices: sortedSourceIndices(item.source_indices),
  };
}

function deduplicateClaims(items = [], language = "es", limit = 4) {
  const seen = new Set();
  const result = [];

  for (const rawItem of Array.isArray(items) ? items : []) {
    const item = refineClaim(rawItem, language);
    const key = normalizeText(item.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }

  return result;
}

function refineConfidence(confidence = {}, articles = [], language = "es") {
  const highLevelDirect = (Array.isArray(articles) ? articles : []).filter(
    (article) =>
      Number(article.query_relevance_score || 0) >= 65 &&
      Number(article.evidence_level_rank || 0) >= 7
  ).length;

  let score = Math.min(88, Number(confidence.score || 0));
  if (highLevelDirect < 2) score = Math.min(score, 80);
  if (!articles.length) score = 0;

  const levelKey = score >= 75 ? "high" : score >= 50 ? "moderate" : "limited";
  const labels = {
    es: { high: "Alto", moderate: "Moderado", limited: "Limitado" },
    en: { high: "High", moderate: "Moderate", limited: "Limited" },
  };
  const rationale =
    language === "en"
      ? highLevelDirect >= 2
        ? "Confidence is high for the general direction of care, but lower for selecting a specific modality, dose, or progression because the evidence is heterogeneous."
        : "The available evidence supports general clinical principles, but certainty is lower for specific prescriptions and patient-level decisions."
      : highLevelDirect >= 2
        ? "La confianza es alta para la orientación general del manejo, pero menor para elegir una modalidad, dosis o progresión específica porque la evidencia es heterogénea."
        : "La evidencia disponible respalda principios clínicos generales, pero la certeza es menor para prescripciones específicas y decisiones individuales.";

  return {
    ...confidence,
    level: labels[language]?.[levelKey] || labels.es[levelKey],
    level_key: levelKey,
    score,
    rationale,
    metrics: {
      ...(confidence.metrics || {}),
      concise_chat_high_level_direct_count: highLevelDirect,
      concise_chat_confidence_version: "1.1.0",
    },
  };
}

function refineStructuredClinicalChatFinal(
  structured = {},
  articles = [],
  language = "es"
) {
  const confidence = refineConfidence(
    structured.confidence || {},
    articles,
    language
  );

  return {
    ...structured,
    brief_answer: deduplicateClaims(structured.brief_answer, language, 2),
    clinical_application: deduplicateClaims(
      structured.clinical_application,
      language,
      4
    ),
    assessment_considerations: deduplicateClaims(
      structured.assessment_considerations,
      language,
      3
    ),
    precautions: deduplicateClaims(structured.precautions, language, 2),
    confidence,
  };
}

function citationSuffix(indices = []) {
  const normalized = sortedSourceIndices(indices);
  return normalized.length ? ` [${normalized.join(",")}]` : "";
}

function renderClaim(item = {}) {
  return `${String(item.text || "").trim()}${citationSuffix(
    item.source_indices
  )}`.trim();
}

function renderConciseChatReply(structured = {}, language = "es") {
  const isEnglish = language === "en";
  const labels = isEnglish
    ? {
        answer: "**Clinical answer**",
        application: "**Clinical application**",
        assessment: "**Assess before applying**",
        precautions: "**Limits and precautions**",
        confidence: "**Confidence**",
      }
    : {
        answer: "**Respuesta clínica**",
        application: "**Aplicación clínica**",
        assessment: "**Antes de aplicarlo**",
        precautions: "**Límites y precauciones**",
        confidence: "**Confianza**",
      };

  const lines = [labels.answer];
  (structured.brief_answer || []).forEach((item) => lines.push(renderClaim(item)));

  const sections = [
    [labels.application, structured.clinical_application],
    [labels.assessment, structured.assessment_considerations],
    [labels.precautions, structured.precautions],
  ];

  sections.forEach(([label, items]) => {
    if (!items?.length) return;
    lines.push("", label);
    items.forEach((item) => lines.push(`- ${renderClaim(item)}`));
  });

  if (structured.confidence) {
    lines.push(
      "",
      labels.confidence,
      `${structured.confidence.level} (${structured.confidence.score}/100). ${structured.confidence.rationale}`
    );
  }

  return lines.join("\n").trim();
}

module.exports = {
  removeUnsupportedPrecision,
  refineStructuredClinicalChatFinal,
  renderConciseChatReply,
  refineConfidence,
};
