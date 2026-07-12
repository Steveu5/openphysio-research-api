const MODALITIES = [
  { key: "mckenzie", terms: ["mckenzie"] },
  { key: "pilates", terms: ["pilates"] },
  { key: "yoga", terms: ["yoga"] },
  { key: "tai_chi", terms: ["tai chi"] },
  {
    key: "motor_control",
    terms: ["motor control", "control motor", "core exercise", "core-based"],
  },
  {
    key: "strength",
    terms: ["strength", "strengthening", "resistance training", "fuerza", "fortalecimiento"],
  },
  { key: "aquatic", terms: ["aquatic", "water-based", "acuatico", "acuático"] },
  { key: "aerobic", terms: ["aerobic", "aerobico", "aeróbico"] },
  {
    key: "manual_therapy",
    terms: ["manual therapy", "terapia manual"],
  },
  {
    key: "cognitive_functional",
    terms: ["cognitive functional therapy", "terapia funcional cognitiva"],
  },
];

function normalize(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function articleEvidenceText(article = {}) {
  return normalize(
    [article.title, article.abstract, article.clinical_takeaway]
      .filter(Boolean)
      .join(" ")
  );
}

function citedArticles(item = {}, articles = []) {
  const indices = Array.isArray(item.source_indices)
    ? item.source_indices
    : [];
  return indices
    .map((index) => articles[Number(index) - 1])
    .filter(Boolean);
}

function mentionedModalities(text = "") {
  const normalized = normalize(text);
  return MODALITIES.filter((modality) =>
    modality.terms.some((term) => normalized.includes(normalize(term)))
  );
}

function modalitySupported(modality, sources = []) {
  return sources.some((article) => {
    const text = articleEvidenceText(article);
    return modality.terms.some((term) => text.includes(normalize(term)));
  });
}

function isOverstrongComparativeClaim(text = "") {
  const normalized = normalize(text);
  return [
    "ningun tipo es claramente superior",
    "ninguna modalidad es claramente superior",
    "no modality is clearly superior",
    "es claramente superior",
    "is clearly superior",
  ].some((signal) => normalized.includes(signal));
}

function claimsClinicalImportance(text = "") {
  const normalized = normalize(text);
  return (
    normalized.includes("clinicamente importante") ||
    normalized.includes("clinically important") ||
    normalized.includes("clinically meaningful")
  );
}

function clinicalImportanceSupported(sources = []) {
  return sources.some((article) => {
    const text = articleEvidenceText(article);
    return (
      text.includes("clinically important") ||
      text.includes("clinically meaningful") ||
      text.includes("minimal clinically important") ||
      text.includes("minimally important")
    );
  });
}

function cautiousComparativeText(language = "es") {
  return language === "en"
    ? "Several exercise modalities may be beneficial, but comparative superiority is not consistent across outcomes, populations, and certainty of evidence."
    : "Varias modalidades de ejercicio pueden ser beneficiosas, pero la superioridad comparativa no es uniforme entre resultados, poblaciones y niveles de certeza.";
}

function cautiousClinicalBenefitText(language = "es") {
  return language === "en"
    ? "Several exercise modalities may improve pain or disability compared with no treatment or usual care, although effect magnitude and certainty vary across modalities and outcomes."
    : "Varias modalidades de ejercicio pueden mejorar el dolor o la discapacidad frente a la ausencia de tratamiento o la atención habitual, aunque la magnitud del efecto y la certeza varían entre modalidades y resultados.";
}

function sanitizeClaim(item = {}, articles = [], language = "es") {
  const sources = citedArticles(item, articles);
  const modalities = mentionedModalities(item.text);
  const unsupported = modalities.filter(
    (modality) => !modalitySupported(modality, sources)
  );

  if (unsupported.length > 0 || isOverstrongComparativeClaim(item.text)) {
    return {
      ...item,
      text: cautiousComparativeText(language),
    };
  }

  if (
    claimsClinicalImportance(item.text) &&
    !clinicalImportanceSupported(sources)
  ) {
    return {
      ...item,
      text: cautiousClinicalBenefitText(language),
    };
  }

  return item;
}

function interventionGroups(articles = []) {
  const groups = new Set();

  for (const article of articles.slice(0, 8)) {
    const text = articleEvidenceText(article);
    for (const modality of MODALITIES) {
      if (modality.terms.some((term) => text.includes(normalize(term)))) {
        groups.add(modality.key);
      }
    }
  }

  return groups;
}

function adjustConfidence(confidence = {}, articles = [], language = "es") {
  const groups = interventionGroups(articles);
  const indirectCount = articles.filter(
    (article) => article.clinical_directness === "indirect"
  ).length;
  const complementaryCount = articles.filter(
    (article) => article.clinical_directness === "complementary"
  ).length;
  const protocolCount = articles.filter((article) => {
    const text = normalize(
      `${article.evidence_level || ""} ${article.study_type || ""}`
    );
    return text.includes("protocol") || text.includes("protocolo");
  }).length;

  let score = Math.min(92, Number(confidence.score || 0));
  if (groups.size >= 4) score = Math.min(score, 88);
  if (complementaryCount >= 4) score = Math.min(score, 88);
  if (indirectCount > 0) score = Math.min(score, 84);
  if (protocolCount > 0) score = Math.min(score, 80);

  let levelKey = "limited";
  if (score >= 75) levelKey = "high";
  else if (score >= 50) levelKey = "moderate";

  const labels = {
    es: { high: "Alto", moderate: "Moderado", limited: "Limitado" },
    en: { high: "High", moderate: "Moderate", limited: "Limited" },
  };

  let rationale = confidence.rationale || "";
  if (groups.size >= 4 || complementaryCount >= 4) {
    rationale =
      language === "en"
        ? "Confidence is high for the general benefit of exercise, but lower for choosing one modality, dose, or progression because the evidence is heterogeneous and includes modality-specific studies."
        : "La confianza es alta para el beneficio general del ejercicio, pero menor para elegir una modalidad, dosis o progresión específica porque la evidencia es heterogénea e incluye estudios de modalidades concretas.";
  } else if (indirectCount > 0) {
    rationale =
      language === "en"
        ? "Direct evidence was accompanied by some indirect evidence, which limits precision for clinical application."
        : "La evidencia directa estuvo acompañada por evidencia indirecta, lo que limita la precisión para la aplicación clínica.";
  }

  return {
    ...confidence,
    level: labels[language]?.[levelKey] || labels.es[levelKey],
    level_key: levelKey,
    score,
    rationale,
    metrics: {
      ...(confidence.metrics || {}),
      intervention_group_count: groups.size,
      complementary_article_count: complementaryCount,
      indirect_article_count: indirectCount,
      protocol_count: protocolCount,
      confidence_cap_version: "1.1.0",
    },
  };
}

function refineStructuredResearchAnswer(
  structured = {},
  confidence = {},
  articles = [],
  language = "es"
) {
  const adjustedConfidence = adjustConfidence(confidence, articles, language);
  const sanitizeList = (items) =>
    (Array.isArray(items) ? items : []).map((item) =>
      sanitizeClaim(item, articles, language)
    );

  return {
    structured: {
      ...structured,
      clinical_answer: sanitizeList(structured.clinical_answer),
      key_findings: sanitizeList(structured.key_findings),
      evidence_relationships: sanitizeList(
        structured.evidence_relationships
      ),
      confidence: adjustedConfidence,
    },
    confidence: adjustedConfidence,
  };
}

module.exports = {
  mentionedModalities,
  sanitizeClaim,
  adjustConfidence,
  refineStructuredResearchAnswer,
};
