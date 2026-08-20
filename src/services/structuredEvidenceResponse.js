const { callDeepSeek } = require("./deepseek");
const {
  applyResearchNarrativeTranslations,
  collectResearchNarrativeFields,
  isResearchNarrativeLanguageCompliant,
} = require("./researchResponseLanguage");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeLanguage(intent = {}, fallbackText = "") {
  const language = String(intent.language || "").toLowerCase();
  if (language === "en") return "en";
  if (language === "es") return "es";

  const text = String(fallbackText || "").toLowerCase();
  const spanishSignals = [
    "qué",
    "que ",
    "cuál",
    "dolor",
    "ejercicio",
    "fisioterapia",
    "paciente",
    "tratamiento",
  ];

  return spanishSignals.some((signal) => text.includes(signal)) ? "es" : "en";
}

function average(values = []) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function calculateEvidenceConfidence(articles = [], language = "es") {
  const top = articles.slice(0, 6);

  if (!top.length) {
    return {
      level: language === "en" ? "Limited" : "Limitado",
      level_key: "limited",
      score: 0,
      rationale:
        language === "en"
          ? "No directly usable evidence was recovered for this question."
          : "No se recuperó evidencia directamente utilizable para esta pregunta.",
      metrics: {
        article_count: 0,
        direct_articles: 0,
        strong_direct_articles: 0,
        high_level_articles: 0,
        abstract_coverage: 0,
      },
    };
  }

  const relevanceValues = top.map((article) =>
    Number(article.query_relevance_score || 0)
  );
  const directArticles = top.filter(
    (article) => Number(article.query_relevance_score || 0) >= 65
  );
  const highLevelArticles = top.filter(
    (article) => Number(article.evidence_level_rank || 0) >= 7
  );
  const strongDirectArticles = top.filter(
    (article) =>
      Number(article.query_relevance_score || 0) >= 65 &&
      Number(article.evidence_level_rank || 0) >= 7
  );
  const preferredDirectArticles = top.filter((article) => {
    const level = String(article.evidence_level || "").toLowerCase();
    return (
      Number(article.query_relevance_score || 0) >= 65 &&
      (level.includes("guideline") || level.includes("systematic_review") || level.includes("meta_analysis"))
    );
  });
  const abstractCoverage =
    top.filter((article) => Boolean(article.abstract)).length / top.length;

  const quantityScore = Math.min(15, top.length * 3);
  const relevanceScore = average(relevanceValues) * 0.35;
  const hierarchyScore = Math.min(
    25,
    strongDirectArticles.length * 8 +
      Math.max(0, highLevelArticles.length - strongDirectArticles.length) * 3
  );
  const metadataScore = abstractCoverage * 15;
  const preferredScore = Math.min(10, preferredDirectArticles.length * 5);

  let score = Math.round(
    quantityScore +
      relevanceScore +
      hierarchyScore +
      metadataScore +
      preferredScore
  );

  if (directArticles.length === 0) score = Math.min(score, 42);
  if (strongDirectArticles.length === 0) score = Math.min(score, 64);
  if (abstractCoverage < 0.5) score = Math.min(score, 58);
  score = clamp(score, 0, 100);

  let levelKey = "limited";
  if (score >= 75) levelKey = "high";
  else if (score >= 50) levelKey = "moderate";

  const labels = {
    es: { high: "Alto", moderate: "Moderado", limited: "Limitado" },
    en: { high: "High", moderate: "Moderate", limited: "Limited" },
  };

  let rationale;
  if (language === "en") {
    if (levelKey === "high") {
      rationale = `${strongDirectArticles.length} high-level article(s) directly matched the question, with adequate abstract coverage.`;
    } else if (levelKey === "moderate") {
      rationale = `${directArticles.length} article(s) were directly relevant, but hierarchy, quantity, or metadata were not consistently strong.`;
    } else {
      rationale = "The recovered evidence was sparse, indirect, low in the hierarchy, or limited by missing abstracts.";
    }
  } else if (levelKey === "high") {
    rationale = `${strongDirectArticles.length} artículo(s) de nivel alto coincidieron directamente con la pregunta y tuvieron cobertura adecuada de resumen.`;
  } else if (levelKey === "moderate") {
    rationale = `${directArticles.length} artículo(s) fueron directamente relevantes, pero la jerarquía, cantidad o metadata no fueron consistentemente sólidas.`;
  } else {
    rationale = "La evidencia recuperada fue escasa, indirecta, de menor jerarquía o limitada por resúmenes ausentes.";
  }

  return {
    level: labels[language]?.[levelKey] || labels.es[levelKey],
    level_key: levelKey,
    score,
    rationale,
    metrics: {
      article_count: top.length,
      direct_articles: directArticles.length,
      strong_direct_articles: strongDirectArticles.length,
      high_level_articles: highLevelArticles.length,
      abstract_coverage: Number(abstractCoverage.toFixed(2)),
      average_query_relevance: Math.round(average(relevanceValues)),
    },
  };
}

function compactArticle(article = {}, index, abstractLimit = 2200) {
  return {
    source_index: index + 1,
    title: article.title,
    year: article.year,
    study_type: article.study_type,
    journal: article.journal,
    doi: article.doi,
    source_url: article.source_url,
    abstract: article.abstract
      ? String(article.abstract).slice(0, abstractLimit)
      : null,
    clinical_takeaway: article.clinical_takeaway || null,
    evidence_level: article.evidence_level || null,
    evidence_level_label_es: article.evidence_level_label_es || null,
    evidence_level_label_en: article.evidence_level_label_en || null,
    evidence_level_rank: article.evidence_level_rank || null,
    article_quality_score: article.openphysio_evidence_score || null,
    query_relevance_score: article.query_relevance_score || null,
    reading_priority_score: article.reading_priority_score || null,
    relevance_flags: article.query_relevance_flags || [],
    relevance_limitations: article.query_relevance_limitations || [],
    appraisal_flags: article.appraisal_flags || [],
    caution_flags: article.caution_flags || [],
  };
}

function parseJsonObject(content = "") {
  const text = String(content || "").trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) return null;

    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }
}

function normalizeTextArray(value, maxItems = 6) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeSourceIndices(value, maxSourceIndex) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return Array.from(
    new Set(
      values
        .map((item) => Number(item))
        .filter(
          (item) =>
            Number.isInteger(item) && item >= 1 && item <= maxSourceIndex
        )
    )
  ).slice(0, 4);
}

function normalizeClaimList(value, maxSourceIndex, maxItems = 6) {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((item) => {
      if (typeof item === "string") {
        return { text: item.trim(), source_indices: [] };
      }

      return {
        text: String(item?.text || "").trim(),
        source_indices: normalizeSourceIndices(
          item?.source_indices,
          maxSourceIndex
        ),
      };
    })
    .filter((item) => item.text)
    .slice(0, maxItems);
}

function citationSuffix(indices = []) {
  if (!indices.length) return "";
  return ` [${indices.join(",")}]`;
}

function renderClaim(item = {}) {
  return `${item.text || ""}${citationSuffix(item.source_indices)}`.trim();
}

function buildResearchFallback(articles, confidence, language) {
  const top = articles.slice(0, 3);
  const isEnglish = language === "en";

  return {
    clinical_answer: [],
    key_findings: top.map((article, index) => ({
      text: isEnglish
        ? `${article.title} was identified as one of the sources most closely aligned with the search.`
        : `${article.title} fue identificado como una de las fuentes con mayor coincidencia con la búsqueda.`,
      source_indices: [index + 1],
    })),
    evidence_relationships: [],
    consistency_level: "uncertain",
    reading_path: [],
    uncertainties: [
      isEnglish
        ? "The available metadata was insufficient to produce a reliable cross-study synthesis."
        : "La metadata disponible fue insuficiente para producir una síntesis confiable entre estudios.",
    ],
    methodological_caution: isEnglish
      ? "The automatic ranking guides reading but does not replace full critical appraisal."
      : "El ranking automático orienta la lectura, pero no reemplaza la evaluación crítica completa.",
    confidence,
  };
}

function normalizeResearchStructure(raw, articles, confidence, language) {
  if (!raw || typeof raw !== "object") {
    return buildResearchFallback(articles, confidence, language);
  }

  return {
    // Compatibility fields remain present for the existing safety pipeline.
    // Research describes literature findings; Clinical Chat owns clinical answers.
    clinical_answer: [],
    key_findings: normalizeClaimList(raw.key_findings, articles.length, 5),
    evidence_relationships: normalizeClaimList(
      raw.evidence_relationships,
      articles.length,
      3
    ),
    consistency_level: ["high", "moderate", "low", "uncertain"].includes(
      String(raw.consistency_level || "").toLowerCase()
    )
      ? String(raw.consistency_level).toLowerCase()
      : "uncertain",
    reading_path: [],
    uncertainties: normalizeTextArray(raw.uncertainties, 3),
    methodological_caution: String(
      raw.methodological_caution ||
        (language === "en"
          ? "The automatic ranking guides reading but does not replace full critical appraisal."
          : "El ranking automático orienta la lectura, pero no reemplaza la evaluación crítica completa.")
    ).trim(),
    confidence,
  };
}

async function translateResearchNarrativeFields(fields, language) {
  const targetLanguage = language === "es" ? "Spanish" : "English";
  const content = await callDeepSeek(
    [
      {
        role: "system",
        content: [
          `Translate every text value into ${targetLanguage}.`,
          "Preserve clinical meaning, numbers, abbreviations, and uncertainty.",
          "Do not add, remove, summarize, or reinterpret any evidence.",
          "Keep every id unchanged and return only valid JSON.",
          'Required shape: {"translations":[{"id":"...","text":"..."}]}',
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          target_language: targetLanguage,
          translations: fields,
        }),
      },
    ],
    { json: true, maxTokens: 1400, temperature: 0 }
  );

  const parsed = parseJsonObject(content);
  return Array.isArray(parsed?.translations) ? parsed.translations : [];
}

async function ensureResearchStructureLanguage({
  structured,
  articles,
  confidence,
  language,
}) {
  const baseDiagnostics = {
    version: "1.0.0",
    requested_language: language,
    corrected: false,
    fallback_used: false,
  };

  if (isResearchNarrativeLanguageCompliant(structured, language)) {
    return { structured, diagnostics: baseDiagnostics };
  }

  try {
    const fields = collectResearchNarrativeFields(structured);
    const translations = await translateResearchNarrativeFields(
      fields,
      language
    );
    const translated = applyResearchNarrativeTranslations(
      structured,
      translations
    );

    if (isResearchNarrativeLanguageCompliant(translated, language)) {
      return {
        structured: translated,
        diagnostics: {
          ...baseDiagnostics,
          corrected: true,
        },
      };
    }
  } catch (error) {
    console.warn(
      "Research language correction error:",
      error?.message || error
    );
  }

  return {
    structured: buildResearchFallback(articles, confidence, language),
    diagnostics: {
      ...baseDiagnostics,
      corrected: true,
      fallback_used: true,
    },
  };
}

function renderResearchReply(structured, language = "es") {
  const isEnglish = language === "en";
  const labels = isEnglish
    ? {
        confidence: "Evidence confidence",
        found: "Scientific findings",
        relationships: "Consistency across studies",
        caution: "Limits of the evidence",
      }
    : {
        confidence: "Confianza de la evidencia",
        found: "Hallazgos científicos",
        relationships: "Consistencia entre estudios",
        caution: "Límites de la evidencia",
      };

  const lines = [labels.found];
  (structured.key_findings || []).forEach((item) =>
    lines.push(`- ${renderClaim(item)}`)
  );

  lines.push(
    "",
    `${labels.confidence}: ${structured.confidence.level} (${structured.confidence.score}/100). ${structured.confidence.rationale}`
  );

  if (structured.evidence_relationships?.length) {
    lines.push("", labels.relationships);
    structured.evidence_relationships.forEach((item) =>
      lines.push(`- ${renderClaim(item)}`)
    );
  }

  lines.push("", labels.caution);
  (structured.uncertainties || []).forEach((item) =>
    lines.push(`- ${item}`)
  );
  lines.push(structured.methodological_caution);

  return lines.join("\n").trim();
}

async function generateStructuredResearchAnswer({
  originalQuery,
  intent,
  articles = [],
}) {
  const language = normalizeLanguage(intent, originalQuery);
  const compactArticles = articles.map((article, index) =>
    compactArticle(article, index, 2400)
  );
  const confidence = calculateEvidenceConfidence(articles, language);

  if (!compactArticles.length) {
    const structured = buildResearchFallback([], confidence, language);
    return {
      reply: renderResearchReply(structured, language),
      structured,
      confidence,
      languageGuard: {
        version: "1.0.0",
        requested_language: language,
        corrected: false,
        fallback_used: true,
      },
    };
  }

  const system = `
You are OpenPhysioAI Research, a physiotherapy evidence synthesis system.
Answer in ${language === "en" ? "English" : "Spanish"}.
Use ONLY the supplied article metadata and abstract text.
Never invent articles, outcomes, effect sizes, dosages, risk-of-bias results, or conclusions.
Research is not Clinical Chat. Describe what the retrieved literature found; do not prescribe treatment, recommend what a patient should do, or produce a second clinical answer.
Every evidentiary claim must include source_indices pointing to the supplied source_index values.
If the supplied abstracts do not support a conclusion, place it in uncertainties instead of asserting it.
The confidence object is calculated by the backend and MUST NOT be changed or reinterpreted.

Return ONLY valid JSON with this exact shape:
{
  "key_findings": [{"text":"...","source_indices":[1]}],
  "evidence_relationships": [{"text":"...","source_indices":[1,3]}],
  "consistency_level": "high|moderate|low|uncertain",
  "uncertainties": ["..."],
  "methodological_caution": "..."
}

Rules:
- key_findings: 3 to 5 distinct cross-study findings. Synthesize results across articles instead of summarizing each article separately. State what was studied and observed, not what the user should do.
- Avoid repeating the same conclusion with different wording.
- evidence_relationships: maximum 3. Explain convergence, disagreement, or complementary scope across studies; do not create a reading path.
- consistency_level: use high when findings broadly converge, moderate for important heterogeneity, low for material contradiction, and uncertain when metadata is insufficient.
- uncertainties: maximum 3 and explicitly state missing dose, follow-up, population match, inconsistency, or limited metadata when relevant.
- source_indices may only contain numbers present in the supplied articles.
- Do not include a references section; the application renders the indexed articles separately.
`.trim();

  const content = await callDeepSeek(
    [
      { role: "system", content: system },
      {
        role: "user",
        content: JSON.stringify(
          {
            original_query: originalQuery,
            interpreted_strategy: intent,
            backend_confidence: confidence,
            articles: compactArticles,
          },
          null,
          2
        ),
      },
    ],
    { json: true, maxTokens: 1400, temperature: 0.05 }
  );

  const parsed = parseJsonObject(content);
  const structured = normalizeResearchStructure(
    parsed,
    articles,
    confidence,
    language
  );
  const aligned = await ensureResearchStructureLanguage({
    structured,
    articles,
    confidence,
    language,
  });

  return {
    reply: renderResearchReply(aligned.structured, language),
    structured: aligned.structured,
    confidence,
    languageGuard: aligned.diagnostics,
  };
}

function buildChatFallback(articles, confidence, language) {
  const isEnglish = language === "en";
  const first = articles[0];

  return {
    brief_answer: [
      {
        text: first
          ? isEnglish
            ? `The available evidence should be interpreted starting with ${first.title}.`
            : `La evidencia disponible debe interpretarse comenzando por ${first.title}.`
          : isEnglish
            ? "There was not enough directly usable evidence to answer safely."
            : "No hubo evidencia directamente utilizable suficiente para responder con seguridad.",
        source_indices: first ? [1] : [],
      },
    ],
    clinical_application: [],
    assessment_considerations: [],
    precautions: [
      {
        text: isEnglish
          ? "Individual assessment and review of the original sources are required before clinical application."
          : "Se requiere evaluación individual y revisión de las fuentes originales antes de la aplicación clínica.",
        source_indices: [],
      },
    ],
    confidence,
  };
}

function normalizeChatStructure(raw, articles, confidence, language) {
  if (!raw || typeof raw !== "object") {
    return buildChatFallback(articles, confidence, language);
  }

  return {
    brief_answer: normalizeClaimList(raw.brief_answer, articles.length, 4),
    clinical_application: normalizeClaimList(
      raw.clinical_application,
      articles.length,
      6
    ),
    assessment_considerations: normalizeClaimList(
      raw.assessment_considerations,
      articles.length,
      5
    ),
    precautions: normalizeClaimList(raw.precautions, articles.length, 5),
    confidence,
  };
}

function renderChatReply(structured, articles, language = "es") {
  const isEnglish = language === "en";
  const labels = isEnglish
    ? {
        answer: "**Clinical answer**",
        application: "**Clinical application**",
        assessment: "**Assess before applying**",
        precautions: "**Precautions and limits**",
        confidence: "**Confidence**",
        sources: "**Sources used**",
      }
    : {
        answer: "**Respuesta clínica**",
        application: "**Cómo aplicarlo en clínica**",
        assessment: "**Qué evaluar antes de aplicarlo**",
        precautions: "**Precauciones y límites**",
        confidence: "**Nivel de confianza**",
        sources: "**Fuentes usadas**",
      };

  const lines = [labels.answer];
  (structured.brief_answer || []).forEach((item) =>
    lines.push(renderClaim(item))
  );

  if (structured.clinical_application?.length) {
    lines.push("", labels.application);
    structured.clinical_application.forEach((item) =>
      lines.push(`- ${renderClaim(item)}`)
    );
  }

  if (structured.assessment_considerations?.length) {
    lines.push("", labels.assessment);
    structured.assessment_considerations.forEach((item) =>
      lines.push(`- ${renderClaim(item)}`)
    );
  }

  if (structured.precautions?.length) {
    lines.push("", labels.precautions);
    structured.precautions.forEach((item) =>
      lines.push(`- ${renderClaim(item)}`)
    );
  }

  lines.push(
    "",
    labels.confidence,
    `${structured.confidence.level} (${structured.confidence.score}/100). ${structured.confidence.rationale}`
  );

  if (articles.length) {
    lines.push("", labels.sources);
    articles.slice(0, 6).forEach((article, index) => {
      lines.push(
        `[${index + 1}] ${article.title}${article.year ? ` (${article.year})` : ""}`
      );
    });
  }

  return lines.join("\n").trim();
}

async function generateStructuredClinicalChatAnswer({
  question,
  intent,
  articles = [],
  messages = [],
}) {
  const language = normalizeLanguage(intent, question);
  const citedArticles = articles.slice(0, 6);
  const compactArticles = citedArticles.map((article, index) =>
    compactArticle(article, index, 2600)
  );
  const confidence = calculateEvidenceConfidence(citedArticles, language);
  const compactMessages = (messages || [])
    .slice(-8)
    .map((message) => ({
      role:
        message.role === "assistant" || message.role === "bot"
          ? "assistant"
          : "user",
      content: String(message.content || message.text || "").slice(0, 1000),
    }))
    .filter((message) => message.content);

  if (!compactArticles.length) {
    const structured = buildChatFallback([], confidence, language);
    return {
      reply: renderChatReply(structured, [], language),
      structured,
      confidence,
    };
  }

  const system = `
You are OpenPhysioAI Clinical Chat, an evidence-based physiotherapy assistant.
Answer in ${language === "en" ? "English" : "Spanish"}.
Use ONLY the supplied evidence snippets and recent conversation.
Do not diagnose from a short message and do not replace clinical assessment.
Do not invent dosages, effect sizes, contraindications, tests, protocols, or conclusions.
Every evidence-based claim must include source_indices. Patient-specific reasoning that is not directly stated in an article may use an empty source_indices array, but it must be framed as an assessment consideration rather than a proven finding.
The confidence object is calculated by the backend and MUST NOT be changed.

Return ONLY valid JSON:
{
  "brief_answer": [{"text":"...","source_indices":[1,2]}],
  "clinical_application": [{"text":"...","source_indices":[1]}],
  "assessment_considerations": [{"text":"...","source_indices":[]}],
  "precautions": [{"text":"...","source_indices":[2]}]
}

Rules:
- brief_answer: 1 to 4 short direct statements.
- clinical_application: maximum 6 practical principles; exact prescriptions only when supported by the supplied abstract.
- assessment_considerations: maximum 5 patient-specific factors such as irritability, load tolerance, function, goals, comorbidities, adherence, preferences, and red flags when relevant.
- precautions: maximum 5; clearly distinguish evidence uncertainty from patient safety.
- source_indices may only contain supplied source_index values.
- Adapt the structure to the question while preserving these fields.
`.trim();

  const content = await callDeepSeek(
    [
      { role: "system", content: system },
      {
        role: "user",
        content: JSON.stringify(
          {
            latest_question: question,
            interpreted_strategy: intent,
            recent_conversation: compactMessages,
            backend_confidence: confidence,
            prioritized_evidence: compactArticles,
          },
          null,
          2
        ),
      },
    ],
    { json: true, maxTokens: 1700, temperature: 0.06 }
  );

  const parsed = parseJsonObject(content);
  const structured = normalizeChatStructure(
    parsed,
    citedArticles,
    confidence,
    language
  );

  return {
    reply: renderChatReply(structured, citedArticles, language),
    structured,
    confidence,
  };
}

module.exports = {
  calculateEvidenceConfidence,
  generateStructuredResearchAnswer,
  generateStructuredClinicalChatAnswer,
  renderResearchReply,
  renderChatReply,
};
