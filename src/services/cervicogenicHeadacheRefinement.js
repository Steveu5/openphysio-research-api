const { searchPubMed } = require("./pubmed");
const { normalizeArticle } = require("./normalize");
const { annotateSourcePriority } = require("./sourcePriority");
const { deduplicateArticles } = require("./evidenceSearchEngine");
const { normalizeText } = require("./conditionConcepts");
const { isProtocolEvidence } = require("./evidenceSelectionGuard");

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
const SPECIFIC_MODALITY_TERMS = [
  "dry needling",
  "tuina",
  "acupuncture",
  "proprioceptive",
  "perineural",
  "massage",
];

function includesAny(text = "", terms = []) {
  const normalized = normalizeText(text);
  return terms.some((term) => normalized.includes(normalizeText(term)));
}

function isCervicogenicHeadacheQuery(query = "", intent = {}) {
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

function articleTitle(article = {}) {
  return normalizeText(article.title || "");
}

function isConditionSpecific(article = {}) {
  return includesAny(articleTitle(article), CGH_TERMS);
}

function isGuideline(article = {}) {
  const text = normalizeText(
    `${article.study_type || ""} ${article.evidence_level || ""} ${article.title || ""}`
  );
  return text.includes("guideline") || text.includes("guia") || Boolean(article.library_resource);
}

function isReview(article = {}) {
  const text = normalizeText(
    `${article.study_type || ""} ${article.evidence_level || ""}`
  );
  return (
    text.includes("systematic review") ||
    text.includes("meta analysis") ||
    text.includes("meta-analysis") ||
    normalizeText(article.journal || "").includes("cochrane")
  );
}

function isTrial(article = {}) {
  const text = normalizeText(
    `${article.study_type || ""} ${article.evidence_level || ""}`
  );
  return (
    text.includes("randomized") ||
    text.includes("randomised") ||
    text.includes("ensayo clinico")
  );
}

function isExternalNeckGuideline(article = {}) {
  if (article.library_resource || !isGuideline(article)) return false;
  const title = articleTitle(article);
  return includesAny(title, NECK_TERMS) && !isConditionSpecific(article);
}

function refineLibraryGuidesForCervicogenicHeadache(
  guides = [],
  query = "",
  intent = {}
) {
  if (!isCervicogenicHeadacheQuery(query, intent)) return guides;

  return guides.map((guide) => {
    if (isConditionSpecific(guide)) return guide;

    return {
      ...guide,
      query_relevance_score: Math.min(82, Number(guide.query_relevance_score || 0)),
      reading_priority_score: Math.min(88, Number(guide.reading_priority_score || 0)),
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
      library_resource: guide.library_resource
        ? {
            ...guide.library_resource,
            applicability: "component_framework",
          }
        : guide.library_resource,
    };
  });
}

async function getTargetedCervicogenicHeadacheArticles({
  query = "",
  intent = {},
  limit = 14,
} = {}) {
  if (!isCervicogenicHeadacheQuery(query, intent)) return [];

  const targetedQuery =
    '("cervicogenic headache"[Title/Abstract]) AND ' +
    '(physiotherapy[Title/Abstract] OR "physical therapy"[Title/Abstract] OR ' +
    'exercise[Title/Abstract] OR "manual therapy"[Title/Abstract] OR ' +
    'rehabilitation[Title/Abstract] OR manipulation[Title/Abstract] OR ' +
    'mobilization[Title/Abstract])';

  try {
    const raw = await searchPubMed(
      targetedQuery,
      Math.max(6, Math.min(Number(limit) || 14, 16)),
      intent.filters || {}
    );

    return raw
      .map((article) => normalizeArticle(article, intent))
      .map((article) => annotateSourcePriority(article, intent))
      .map((article) => ({
        ...article,
        targeted_search_strategy: "cervicogenic_headache_specific",
      }));
  } catch (error) {
    console.warn(
      "Cervicogenic headache targeted PubMed search error:",
      error?.message || error
    );
    return [];
  }
}

function roleForArticle(article = {}) {
  if (article.library_resource) return "complementary";

  const title = articleTitle(article);
  const specific = isConditionSpecific(article);
  const context = includesAny(title, CONTEXT_TERMS);
  const modalitySpecific = includesAny(title, SPECIFIC_MODALITY_TERMS);

  if (specific && !context) {
    if (isReview(article) && !modalitySpecific) return "primary";
    if (isTrial(article) && !modalitySpecific) return "primary";
    return "complementary";
  }

  if (includesAny(title, NECK_TERMS)) return "complementary";
  return "context";
}

function scopeForArticle(article = {}, role = "context") {
  if (article.library_resource) return "component_framework";
  if (isConditionSpecific(article)) {
    if (role === "primary" && isReview(article)) return "condition_specific_synthesis";
    if (role === "primary" && isTrial(article)) return "condition_specific_trial";
    return "condition_specific_modality";
  }
  if (includesAny(articleTitle(article), NECK_TERMS)) return "neck_pain_context";
  return "context_only";
}

function scoreArticle(article = {}, role = "context", scope = "context_only") {
  let relevance = Number(article.query_relevance_score || 0);
  let priority = Number(article.reading_priority_score || 0);

  if (scope === "condition_specific_synthesis") {
    relevance = Math.max(relevance, 92);
    priority = Math.max(priority, 92);
  } else if (scope === "condition_specific_trial") {
    relevance = Math.max(relevance, 86);
    priority = Math.max(priority, 84);
  } else if (scope === "condition_specific_modality") {
    relevance = Math.max(Math.min(relevance, 82), 76);
    priority = Math.max(0, Math.min(priority, 80));
  } else if (scope === "neck_pain_context") {
    relevance = Math.min(relevance, 68);
    priority = Math.max(0, priority - 12);
  } else if (scope === "component_framework") {
    relevance = Math.min(relevance, 82);
    priority = Math.min(Math.max(priority, 84), 88);
  } else {
    relevance = Math.min(relevance, 58);
    priority = Math.max(0, priority - 18);
  }

  return {
    query_relevance_score: Number(relevance.toFixed(2)),
    reading_priority_score: Number(priority.toFixed(2)),
  };
}

function roleRank(role = "") {
  return { primary: 3, complementary: 2, context: 1 }[role] || 0;
}

function scopeRank(scope = "") {
  return {
    component_framework: 7,
    condition_specific_synthesis: 6,
    condition_specific_trial: 5,
    condition_specific_modality: 4,
    neck_pain_context: 3,
    context_only: 1,
  }[scope] || 0;
}

function refineCervicogenicHeadacheResults(
  articles = [],
  query = "",
  intent = {},
  { limit = 20, baseDiagnostics = {} } = {}
) {
  if (!isCervicogenicHeadacheQuery(query, intent)) {
    return { articles, diagnostics: baseDiagnostics };
  }

  const hasLibraryGuide = articles.some((article) => Boolean(article.library_resource));
  const deduplicated = deduplicateArticles(
    articles.filter((article) => {
      if (isProtocolEvidence(article)) return false;
      if (hasLibraryGuide && isExternalNeckGuideline(article)) return false;
      return true;
    })
  );

  const annotated = deduplicated.map((article) => {
    const role = roleForArticle(article);
    const scope = scopeForArticle(article, role);
    const scores = scoreArticle(article, role, scope);

    return {
      ...article,
      ...scores,
      evidence_role: role,
      clinical_directness:
        role === "primary"
          ? "direct"
          : role === "complementary"
            ? "complementary"
            : "indirect",
      scope_match: scope,
      query_scope: "cervicogenic_headache_specific",
    };
  });

  annotated.sort((left, right) => {
    const libraryDifference =
      Number(Boolean(right.library_resource)) - Number(Boolean(left.library_resource));
    if (libraryDifference !== 0) return libraryDifference;

    const roleDifference = roleRank(right.evidence_role) - roleRank(left.evidence_role);
    if (roleDifference !== 0) return roleDifference;

    const scopeDifference = scopeRank(right.scope_match) - scopeRank(left.scope_match);
    if (scopeDifference !== 0) return scopeDifference;

    const evidenceDifference =
      Number(right.evidence_level_rank || 0) - Number(left.evidence_level_rank || 0);
    if (evidenceDifference !== 0) return evidenceDifference;

    return (
      Number(right.reading_priority_score || 0) -
      Number(left.reading_priority_score || 0)
    );
  });

  const specificCount = annotated.filter((article) => isConditionSpecific(article)).length;
  const final = [];
  let neckContextCount = 0;
  let contextCount = 0;

  for (const article of annotated) {
    if (final.length >= Math.max(1, Number(limit) || 20)) break;

    if (specificCount >= 5 && article.scope_match === "neck_pain_context") {
      if (neckContextCount >= 4) continue;
      neckContextCount += 1;
    }

    if (specificCount >= 5 && article.evidence_role === "context") {
      if (contextCount >= 2) continue;
      contextCount += 1;
    }

    final.push(article);
  }

  return {
    articles: final,
    diagnostics: {
      ...baseDiagnostics,
      version: "1.3.0",
      cervicogenic_headache_refinement_version: "1.0.0",
      direct_count: final.filter((article) => article.evidence_role === "primary").length,
      complementary_count: final.filter(
        (article) => article.evidence_role === "complementary"
      ).length,
      indirect_count: final.filter((article) => article.evidence_role === "context").length,
      condition_specific_count: final.filter((article) => isConditionSpecific(article)).length,
      external_neck_guidelines_removed: hasLibraryGuide
        ? articles.filter(isExternalNeckGuideline).length
        : 0,
      output_count: final.length,
      query_scope: "cervicogenic_headache_specific",
    },
  };
}

function citedArticles(item = {}, articles = []) {
  return (Array.isArray(item.source_indices) ? item.source_indices : [])
    .map((index) => articles[Number(index) - 1])
    .filter(Boolean);
}

function lowerFirst(value = "") {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

function refineCervicogenicHeadacheAnswer(
  safeAnswer = {},
  articles = [],
  query = "",
  intent = {},
  language = "es"
) {
  if (!isCervicogenicHeadacheQuery(query, intent)) return safeAnswer;

  const refineItems = (items = []) =>
    items
      .filter((item) => {
        const sources = citedArticles(item, articles);
        if (!sources.length) return true;
        return sources.some(
          (article) =>
            article.evidence_role !== "context" &&
            (isConditionSpecific(article) || article.library_resource)
        );
      })
      .map((item) => {
        const sources = citedArticles(item, articles);
        const singleTrial = sources.length === 1 && isTrial(sources[0]);
        const text = String(item.text || "");
        if (
          singleTrial &&
          /\b(mejora|reduce|improves|reduces)\b/i.test(text) &&
          !/sugiere|suggests/i.test(text)
        ) {
          return {
            ...item,
            text:
              language === "en"
                ? `One clinical trial suggests that ${lowerFirst(text)}`
                : `Un ensayo clínico sugiere que ${lowerFirst(text)}`,
          };
        }
        return item;
      });

  const structured = safeAnswer.structured || {};
  const directSpecificReviews = articles.filter(
    (article) =>
      isConditionSpecific(article) &&
      article.evidence_role === "primary" &&
      isReview(article)
  ).length;
  const currentConfidence = safeAnswer.confidence || structured.confidence || {};
  const score = Math.min(
    Number(currentConfidence.score || 0),
    directSpecificReviews > 0 ? 84 : 80
  );
  const rationale =
    language === "en"
      ? "Condition-specific evidence was available, but it includes heterogeneous interventions and several single trials; the neck pain guideline is used as a related clinical framework rather than as exclusive direct evidence."
      : "Existe evidencia específica para cefalea cervicogénica, pero incluye intervenciones heterogéneas y varios ensayos individuales; la guía cervical se utiliza como marco clínico relacionado y no como evidencia directa exclusiva.";
  const confidence = {
    ...currentConfidence,
    level: score >= 75 ? (language === "en" ? "High" : "Alto") : language === "en" ? "Moderate" : "Moderado",
    level_key: score >= 75 ? "high" : "moderate",
    score,
    rationale,
    metrics: {
      ...(currentConfidence.metrics || {}),
      cervicogenic_headache_specific_review_count: directSpecificReviews,
      cervicogenic_headache_confidence_cap_version: "1.0.0",
    },
  };

  return {
    structured: {
      ...structured,
      clinical_answer: refineItems(structured.clinical_answer),
      key_findings: refineItems(structured.key_findings),
      evidence_relationships: refineItems(structured.evidence_relationships),
      confidence,
    },
    confidence,
  };
}

module.exports = {
  isCervicogenicHeadacheQuery,
  refineLibraryGuidesForCervicogenicHeadache,
  getTargetedCervicogenicHeadacheArticles,
  refineCervicogenicHeadacheResults,
  refineCervicogenicHeadacheAnswer,
};
