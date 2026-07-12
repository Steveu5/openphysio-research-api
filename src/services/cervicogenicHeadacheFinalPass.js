const { normalizeText } = require("./conditionConcepts");

const CGH_TERMS = ["cervicogenic headache", "cefalea cervicogenica"];
const NECK_TERMS = ["neck pain", "cervical pain", "dolor cervical", "cervicalgia"];
const CONTEXT_TERMS = [
  "temporomandibular",
  "orofacial",
  "migraine",
  "muscle thickness",
  "ultrasonographic",
  "botulinum toxin",
];
const NICHE_REVIEW_TERMS = ["tuina", "acupuncture", "dry needling"];

function includesAny(value = "", terms = []) {
  const text = normalizeText(value);
  return terms.some((term) => text.includes(normalizeText(term)));
}

function queryIsCervicogenicHeadache(query = "", intent = {}) {
  const text = normalizeText(
    [
      query,
      intent.condition,
      intent.normalized_query,
      ...(Array.isArray(intent.search_terms) ? intent.search_terms : []),
    ]
      .filter(Boolean)
      .join(" ")
  );
  return includesAny(text, CGH_TERMS);
}

function titleText(article = {}) {
  return normalizeText(article.title || "");
}

function isConditionSpecific(article = {}) {
  return includesAny(titleText(article), CGH_TERMS);
}

function evidenceText(article = {}) {
  return normalizeText(
    [
      article.title,
      article.study_type,
      article.evidence_level,
      article.evidence_level_label_es,
      article.evidence_level_label_en,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function isSystematicReview(article = {}) {
  const text = evidenceText(article);
  return (
    text.includes("systematic review") ||
    text.includes("meta analysis") ||
    text.includes("meta-analysis") ||
    text.includes("revision sistematica") ||
    normalizeText(article.journal || "").includes("cochrane")
  );
}

function isTrial(article = {}) {
  const text = evidenceText(article);
  return (
    text.includes("randomized") ||
    text.includes("randomised") ||
    text.includes("ensayo clinico")
  );
}

function isProtocol(article = {}) {
  const text = evidenceText(article);
  return (
    text.includes("study protocol") ||
    text.includes("review protocol") ||
    text.includes("trial protocol") ||
    text.includes("protocol article")
  );
}

function isNarrativeReviewCandidate(article = {}) {
  if (!isConditionSpecific(article) || isSystematicReview(article) || isTrial(article) || isProtocol(article)) {
    return false;
  }

  const title = titleText(article);
  const metadata = normalizeText(JSON.stringify(article.raw_metadata || {}));
  const current = evidenceText(article);

  return (
    current.includes("review") ||
    metadata.includes("review") ||
    title.includes("current perspectives") ||
    title.includes("how to recognize and treat") ||
    title.includes("occipital neuralgia") ||
    title === "cervicogenic headache" ||
    title.startsWith("cervicogenic headache ")
  );
}

function reclassifyNarrativeReview(article = {}) {
  if (!isNarrativeReviewCandidate(article)) return article;

  return {
    ...article,
    study_type: "narrative review",
    evidence_level: "narrative_review",
    evidence_level_label_es: "Revisión narrativa",
    evidence_level_label_en: "Narrative review",
    evidence_level_rank: Math.max(3, Number(article.evidence_level_rank || 0)),
  };
}

function enforceGuideFramework(article = {}) {
  if (!article.library_resource) return article;

  return {
    ...article,
    guideline_applicability: "component_framework",
    guideline_scope_label_es:
      "Marco clínico relacionado para dolor cervical con cefalea",
    guideline_scope_label_en:
      "Related clinical framework for neck pain with headache",
    guideline_scope_note_es:
      "La guía orienta la clasificación y el manejo del dolor cervical con cefalea, pero no sustituye la evidencia específica de cefalea cervicogénica.",
    guideline_scope_note_en:
      "The guide supports classification and management of neck pain with headache, but it does not replace condition-specific cervicogenic headache evidence.",
    clinical_directness: "complementary",
    evidence_role: "complementary",
    scope_match: "component_framework",
    query_relevance_score: Math.min(82, Math.max(72, Number(article.query_relevance_score || 0))),
    reading_priority_score: Math.min(88, Math.max(84, Number(article.reading_priority_score || 0))),
    library_resource: {
      ...article.library_resource,
      applicability: "component_framework",
    },
  };
}

function classifyArticle(rawArticle = {}) {
  const article = reclassifyNarrativeReview(enforceGuideFramework(rawArticle));
  if (article.library_resource) return article;

  const title = titleText(article);
  const specific = isConditionSpecific(article);
  const context = includesAny(title, CONTEXT_TERMS);
  const neckOnly = includesAny(title, NECK_TERMS) && !specific;
  const nicheReview = isSystematicReview(article) && includesAny(title, NICHE_REVIEW_TERMS);

  let role = "context";
  let directness = "indirect";
  let scope = "context_only";
  let relevance = Number(article.query_relevance_score || 0);
  let priority = Number(article.reading_priority_score || 0);

  if (specific && !context && isSystematicReview(article) && !nicheReview) {
    role = "primary";
    directness = "direct";
    scope = "condition_specific_synthesis";
    relevance = Math.max(relevance, 92);
    priority = Math.max(priority, 92);
  } else if (specific && !context && isTrial(article)) {
    role = "primary";
    directness = "direct";
    scope = "condition_specific_trial";
    relevance = Math.max(relevance, 86);
    priority = Math.max(priority, 84);
  } else if (specific && !context) {
    role = "complementary";
    directness = "complementary";
    scope = isNarrativeReviewCandidate(article)
      ? "condition_specific_narrative"
      : "condition_specific_modality";
    relevance = Math.max(Math.min(relevance, 82), 76);
    priority = Math.max(0, Math.min(priority, 80));
  } else if (context) {
    role = "context";
    directness = "indirect";
    scope = "context_only";
    relevance = Math.min(relevance, 58);
    priority = Math.max(0, priority - 18);
  } else if (neckOnly) {
    role = "complementary";
    directness = "complementary";
    scope = "neck_pain_context";
    relevance = Math.min(relevance, 68);
    priority = Math.max(0, priority - 12);
  }

  return {
    ...article,
    evidence_role: role,
    clinical_directness: directness,
    scope_match: scope,
    query_scope: "cervicogenic_headache_specific",
    query_relevance_score: Number(relevance.toFixed(2)),
    reading_priority_score: Number(priority.toFixed(2)),
  };
}

function scopeRank(article = {}) {
  if (article.library_resource) return 70;
  return {
    condition_specific_synthesis: 60,
    condition_specific_trial: 50,
    condition_specific_modality: 40,
    condition_specific_narrative: 35,
    neck_pain_context: 20,
    context_only: 10,
  }[article.scope_match] || 0;
}

function finalizeCervicogenicHeadacheArticles(
  articles = [],
  query = "",
  intent = {},
  baseDiagnostics = {}
) {
  if (!queryIsCervicogenicHeadache(query, intent)) {
    return { articles, diagnostics: baseDiagnostics };
  }

  const classified = articles.map(classifyArticle);
  classified.sort((left, right) => {
    const scopeDifference = scopeRank(right) - scopeRank(left);
    if (scopeDifference !== 0) return scopeDifference;

    const evidenceDifference =
      Number(right.evidence_level_rank || 0) - Number(left.evidence_level_rank || 0);
    if (evidenceDifference !== 0) return evidenceDifference;

    return (
      Number(right.reading_priority_score || 0) -
      Number(left.reading_priority_score || 0)
    );
  });

  const final = [];
  let neckContextCount = 0;
  let contextCount = 0;

  for (const article of classified) {
    if (article.scope_match === "neck_pain_context") {
      if (neckContextCount >= 3) continue;
      neckContextCount += 1;
    }
    if (article.evidence_role === "context") {
      if (contextCount >= 2) continue;
      contextCount += 1;
    }
    final.push(article);
  }

  return {
    articles: final,
    diagnostics: {
      ...baseDiagnostics,
      version: "1.5.0",
      cervicogenic_headache_final_pass_version: "1.0.0",
      direct_count: final.filter((article) => article.evidence_role === "primary").length,
      complementary_count: final.filter(
        (article) => article.evidence_role === "complementary"
      ).length,
      indirect_count: final.filter((article) => article.evidence_role === "context").length,
      narrative_reviews_reclassified: final.filter(
        (article) => article.evidence_level === "narrative_review"
      ).length,
      query_scope: "cervicogenic_headache_specific",
      output_count: final.length,
    },
  };
}

function relevantCitationIndices(item = {}, articles = []) {
  const original = Array.isArray(item.source_indices) ? item.source_indices : [];
  const valid = original
    .map(Number)
    .filter((index) => Number.isInteger(index) && index >= 1 && index <= articles.length)
    .filter((index) => {
      const article = articles[index - 1];
      return Boolean(article?.library_resource) || isConditionSpecific(article);
    });

  return Array.from(new Set(valid)).sort((left, right) => left - right);
}

function hedgeClinicalText(value = "", language = "es") {
  let text = String(value || "");

  if (language === "en") {
    text = text
      .replace(/manual therapy and therapeutic exercise reduce\b/i, "manual therapy and therapeutic exercise may reduce")
      .replace(/spinal manipulation reduces\b/i, "spinal manipulation may reduce");
    return text;
  }

  return text
    .replace(
      /la terapia manual y el ejercicio terap[eé]utico reducen\b/i,
      "La terapia manual y el ejercicio terapéutico pueden reducir"
    )
    .replace(/la manipulaci[oó]n espinal reduce\b/i, "La manipulación espinal puede reducir");
}

function trialClaimNeedsQualifier(text = "", language = "es") {
  if (language === "en") {
    return (
      /\b(improves|reduces|increases)\b/i.test(text) &&
      !/\b(suggests|may|might|could)\b/i.test(text)
    );
  }

  return (
    /\b(mejora|reduce|aumenta)\b/i.test(text) &&
    !/\b(sugiere|puede|podr[ií]a)\b/i.test(text)
  );
}

function lowerFirst(value = "") {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

function finalizeAnswerItems(items = [], articles = [], language = "es") {
  return items
    .map((item) => {
      if (!item || typeof item !== "object") return item;
      const originalIndices = Array.isArray(item.source_indices)
        ? item.source_indices
        : [];
      const sourceIndices = relevantCitationIndices(item, articles);
      if (originalIndices.length && !sourceIndices.length) return null;

      const sources = sourceIndices.map((index) => articles[index - 1]).filter(Boolean);
      let text = hedgeClinicalText(item.text, language);
      if (
        sources.length === 1 &&
        isTrial(sources[0]) &&
        trialClaimNeedsQualifier(text, language)
      ) {
        text =
          language === "en"
            ? `One clinical trial suggests that ${lowerFirst(text)}`
            : `Un ensayo clínico sugiere que ${lowerFirst(text)}`;
      }

      return {
        ...item,
        text,
        source_indices: sourceIndices,
      };
    })
    .filter(Boolean);
}

function finalizeCervicogenicHeadacheAnswer(
  safeAnswer = {},
  articles = [],
  query = "",
  intent = {},
  language = "es"
) {
  if (!queryIsCervicogenicHeadache(query, intent)) return safeAnswer;

  const structured = safeAnswer.structured || {};
  return {
    ...safeAnswer,
    structured: {
      ...structured,
      clinical_answer: finalizeAnswerItems(
        structured.clinical_answer,
        articles,
        language
      ),
      key_findings: finalizeAnswerItems(structured.key_findings, articles, language),
      evidence_relationships: finalizeAnswerItems(
        structured.evidence_relationships,
        articles,
        language
      ),
    },
  };
}

module.exports = {
  queryIsCervicogenicHeadache,
  finalizeCervicogenicHeadacheArticles,
  finalizeCervicogenicHeadacheAnswer,
};
