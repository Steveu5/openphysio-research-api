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

function articleTypeText(article = {}) {
  return normalizeText(
    [article.evidence_level, article.study_type, article.title]
      .filter(Boolean)
      .join(" ")
  );
}

function isGuidelineArticle(article = {}) {
  const text = articleTypeText(article);
  return (
    text.includes("guideline") ||
    text.includes("guia de practica clinica") ||
    text.includes("clinical practice guideline")
  );
}

function isReviewArticle(article = {}) {
  const text = articleTypeText(article);
  return (
    text.includes("systematic") ||
    text.includes("meta analysis") ||
    text.includes("meta-analysis") ||
    text.includes("revision sistematica") ||
    text.includes("cochrane")
  );
}

function isTrialArticle(article = {}) {
  const text = articleTypeText(article);
  return (
    text.includes("randomized") ||
    text.includes("randomised") ||
    text.includes("ensayo clinico") ||
    text.includes("clinical trial")
  );
}

function indicesFor(articles = [], predicate) {
  return (Array.isArray(articles) ? articles : [])
    .map((article, index) => ({ article, index: index + 1 }))
    .filter(({ article }) => predicate(article))
    .map(({ index }) => index);
}

function buildEvidenceRelationship(articles = [], language = "es") {
  const guidelineIndices = indicesFor(articles, isGuidelineArticle);
  const reviewIndices = indicesFor(articles, isReviewArticle);
  const trialIndices = indicesFor(articles, isTrialArticle);
  const allIndices = sortedSourceIndices([
    ...guidelineIndices,
    ...reviewIndices,
    ...trialIndices,
  ]).slice(0, 4);

  if (!allIndices.length) return null;

  if (guidelineIndices.length && reviewIndices.length) {
    return {
      text:
        language === "en"
          ? "The guideline provides the general clinical framework, while systematic reviews estimate the benefits and limitations of the interventions; clinical studies add detail about specific modalities without establishing one universally superior option."
          : "La guía aporta el marco clínico general, mientras las revisiones sistemáticas estiman los beneficios y límites de las intervenciones; los estudios clínicos añaden información sobre modalidades concretas sin establecer una opción universalmente superior.",
      source_indices: allIndices,
    };
  }

  if (reviewIndices.length && trialIndices.length) {
    return {
      text:
        language === "en"
          ? "Systematic reviews describe the overall direction of the evidence, while clinical trials provide detail about specific interventions; both should be interpreted according to the individual patient context."
          : "Las revisiones sistemáticas describen la orientación general de la evidencia y los ensayos clínicos aportan detalle sobre intervenciones concretas; ambos deben interpretarse según el contexto individual del paciente.",
      source_indices: allIndices,
    };
  }

  return {
    text:
      language === "en"
        ? "The available sources support general clinical principles, but they do not justify treating a single modality as universally superior."
        : "Las fuentes disponibles respaldan principios clínicos generales, pero no justifican considerar una modalidad como universalmente superior.",
    source_indices: allIndices,
  };
}

function buildFollowUpQuestion(question = "", intent = {}, language = "es") {
  const text = normalizeText(
    [
      question,
      intent.condition,
      intent.body_region,
      intent.normalized_query,
    ]
      .filter(Boolean)
      .join(" ")
  );

  if (/lumbar|low back|lumbalgia|espalda baja/.test(text)) {
    return language === "en"
      ? "To refine the recommendation, what currently limits the patient most—pain, activity tolerance, sleep, or participation—and what type of exercise has already been tried?"
      : "Para afinar la recomendación, ¿qué limita más al paciente actualmente —dolor, tolerancia a la actividad, sueño o participación— y qué tipo de ejercicio ya ha probado?";
  }

  if (/cervical|neck|cefalea|headache/.test(text)) {
    return language === "en"
      ? "To refine the recommendation, is the main problem neck pain, headache burden, or functional limitation, and which interventions have already been tried?"
      : "Para afinar la recomendación, ¿predomina el dolor cervical, la carga de cefalea o la limitación funcional, y qué intervenciones ya se han probado?";
  }

  if (/rodilla|knee/.test(text)) {
    return language === "en"
      ? "To refine the recommendation, what activity is most limited and is the main problem pain, strength, swelling, or confidence during loading?"
      : "Para afinar la recomendación, ¿qué actividad está más limitada y predomina el dolor, la pérdida de fuerza, la inflamación o la inseguridad durante la carga?";
  }

  return language === "en"
    ? "To refine the recommendation, what is the patient's main functional limitation and which treatments or exercises have already been tried?"
    : "Para afinar la recomendación, ¿cuál es la principal limitación funcional del paciente y qué tratamientos o ejercicios ya se han probado?";
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
      concise_chat_confidence_version: "1.2.0",
    },
  };
}

function refineStructuredClinicalChatFinal(
  structured = {},
  articles = [],
  language = "es",
  { question = "", intent = {} } = {}
) {
  const confidence = refineConfidence(
    structured.confidence || {},
    articles,
    language
  );
  const relationship = buildEvidenceRelationship(articles, language);

  return {
    ...structured,
    brief_answer: deduplicateClaims(structured.brief_answer, language, 2),
    evidence_relationships: relationship ? [relationship] : [],
    clinical_application: deduplicateClaims(
      structured.clinical_application,
      language,
      3
    ),
    assessment_considerations: deduplicateClaims(
      structured.assessment_considerations,
      language,
      2
    ),
    precautions: deduplicateClaims(structured.precautions, language, 2),
    follow_up_question: buildFollowUpQuestion(question, intent, language),
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

function buildChatEvidenceSynthesisLine(articles = [], language = "es") {
  const list = Array.isArray(articles) ? articles.slice(0, 4) : [];
  const citations = list.length
    ? ` [${list.map((_, index) => index + 1).join(",")}]`
    : "";
  const hasGuideline = list.some(isGuidelineArticle);
  const hasReview = list.some(isReviewArticle);
  const hasTrial = list.some(isTrialArticle);

  if (language === "en") {
    if (hasGuideline && (hasReview || hasTrial)) {
      return `Evidence synthesis: integrates a clinical guideline with prioritized systematic reviews and clinical studies; the guideline is not used as the sole source.${citations}`;
    }
    if (hasReview && hasTrial) {
      return `Evidence synthesis: integrates systematic reviews with prioritized clinical studies.${citations}`;
    }
    return `Evidence synthesis: uses the best prioritized evidence available for this question.${citations}`;
  }

  if (hasGuideline && (hasReview || hasTrial)) {
    return `Síntesis de evidencia: integra una guía clínica con revisiones sistemáticas y estudios clínicos priorizados; la guía no se utiliza como fuente exclusiva.${citations}`;
  }
  if (hasReview && hasTrial) {
    return `Síntesis de evidencia: integra revisiones sistemáticas con estudios clínicos priorizados.${citations}`;
  }
  return `Síntesis de evidencia: utiliza la mejor evidencia priorizada disponible para esta pregunta.${citations}`;
}

function injectChatEvidenceSynthesisIntoReply(
  reply = "",
  articles = [],
  language = "es",
  { markdown = false } = {}
) {
  const line = buildChatEvidenceSynthesisLine(articles, language);
  const text = String(reply || "").trim();
  if (!text) return line;

  const lines = text.split("\n");
  const insertion = markdown ? `**${line}**` : line;
  lines.splice(Math.min(1, lines.length), 0, insertion);
  return lines.join("\n");
}

function renderConciseChatReply(structured = {}, language = "es") {
  const isEnglish = language === "en";
  const labels = isEnglish
    ? {
        answer: "**Clinical answer**",
        relationships: "**How the evidence fits together**",
        application: "**Clinical application**",
        assessment: "**Assess before applying**",
        precautions: "**Limits and precautions**",
        confidence: "**Confidence**",
        continue: "**To continue**",
      }
    : {
        answer: "**Respuesta clínica**",
        relationships: "**Cómo se relaciona la evidencia**",
        application: "**Aplicación clínica**",
        assessment: "**Antes de aplicarlo**",
        precautions: "**Límites y precauciones**",
        confidence: "**Confianza**",
        continue: "**Para continuar**",
      };

  const lines = [labels.answer];
  (structured.brief_answer || []).forEach((item) => lines.push(renderClaim(item)));

  if (structured.evidence_relationships?.length) {
    lines.push("", labels.relationships);
    structured.evidence_relationships.forEach((item) =>
      lines.push(renderClaim(item))
    );
  }

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

  if (structured.follow_up_question) {
    lines.push("", labels.continue, structured.follow_up_question);
  }

  return lines.join("\n").trim();
}

module.exports = {
  removeUnsupportedPrecision,
  refineStructuredClinicalChatFinal,
  renderConciseChatReply,
  refineConfidence,
  buildEvidenceRelationship,
  buildFollowUpQuestion,
  buildChatEvidenceSynthesisLine,
  injectChatEvidenceSynthesisIntoReply,
};
