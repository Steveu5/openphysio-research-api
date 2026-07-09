const {
  getConditionMatch,
  normalizeText,
} = require("./conditionConcepts");
const {
  annotateSourcePriority,
  annotateGuidelineApplicability,
  getPreferredSourcePriority,
  isRelatedJosptGuidelineForIntent,
} = require("./sourcePriority");

const PHYSIOTHERAPY_TERMS = [
  "physiotherapy",
  "physical therapy",
  "rehabilitation",
  "exercise",
  "exercise therapy",
  "manual therapy",
  "mobilization",
  "mobilisation",
  "manipulation",
  "motor control",
  "strengthening",
  "self-management",
  "patient education",
];

const PROTOCOL_SIGNALS = [
  "study protocol",
  "review protocol",
  "protocol for a review",
  "this is the protocol",
  "this protocol describes",
  "the protocol describes",
  "we describe the protocol",
  "aim of this protocol",
  "protocol has been registered",
  "protocol article",
];

const COMPLETED_REVIEW_SIGNALS = [
  "we included",
  "were included",
  "meta-analysis was performed",
  "this systematic review",
  "this meta-analysis",
  "results showed",
  "results suggest",
  "we found",
  "we identified",
];

const COMPETING_HEADACHE_ETIOLOGIES = [
  "post-dural puncture headache",
  "post dural puncture headache",
  "post-lumbar puncture headache",
  "post lumbar puncture headache",
  "spinal anesthesia headache",
  "spinal anaesthesia headache",
  "medication-overuse headache",
  "medication overuse headache",
  "cluster headache",
];

function getArticleText(article = {}) {
  return normalizeText(
    [article.title, article.abstract, article.study_type, article.journal]
      .filter(Boolean)
      .join(" ")
  );
}

function isProtocolEvidence(article = {}) {
  const text = getArticleText(article);
  const hasProtocolSignal = PROTOCOL_SIGNALS.some((term) =>
    text.includes(normalizeText(term))
  );
  const hasCompletedReviewSignal = COMPLETED_REVIEW_SIGNALS.some((term) =>
    text.includes(normalizeText(term))
  );

  return hasProtocolSignal && !hasCompletedReviewSignal;
}

function isPhysiotherapyFocused(article = {}) {
  if (article.is_physiotherapy_relevant === true) return true;
  if (Number(article.physiotherapy_relevance_score || 0) >= 6) return true;

  const text = getArticleText(article);
  return PHYSIOTHERAPY_TERMS.some((term) =>
    text.includes(normalizeText(term))
  );
}

function queryExplicitlyRequestsCompetingEtiology(intent = {}) {
  const queryText = normalizeText(
    [
      intent.condition,
      intent.normalized_query,
      ...(Array.isArray(intent.search_terms) ? intent.search_terms : []),
    ]
      .filter(Boolean)
      .join(" ")
  );

  return COMPETING_HEADACHE_ETIOLOGIES.some((term) =>
    queryText.includes(normalizeText(term))
  );
}

function hasUnrequestedCompetingHeadacheEtiology(article = {}, intent = {}) {
  if (queryExplicitlyRequestsCompetingEtiology(intent)) return false;

  const text = getArticleText(article);
  return COMPETING_HEADACHE_ETIOLOGIES.some((term) =>
    text.includes(normalizeText(term))
  );
}

function normalizeClinicalTitle(title = "") {
  return normalizeText(title)
    .replace(/\b(?:updated|update|version|protocol)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function candidateQuality(article = {}, intent = {}) {
  const conditionMatch = getConditionMatch(article, intent);
  const protocol = isProtocolEvidence(article);
  const abstractLength = String(article.abstract || "").length;
  const year = Number(article.year || 0);
  const queryRelevance = Number(article.query_relevance_score || 0);
  const readingPriority = Number(article.reading_priority_score || 0);
  const sourceTier = getPreferredSourcePriority(article).tier;

  return (
    (protocol ? -120 : 0) +
    sourceTier * 1.5 +
    conditionMatch.ratio * 100 +
    conditionMatch.title_matched_count * 20 +
    (isPhysiotherapyFocused(article) ? 20 : 0) +
    Math.min(25, abstractLength / 120) +
    queryRelevance * 0.3 +
    readingPriority * 0.2 +
    Math.min(10, Math.max(0, year - 2015))
  );
}

function mergeDuplicateArticles(
  preferred = {},
  alternate = {},
  intent = {}
) {
  return annotateSourcePriority(
    {
      ...alternate,
      ...preferred,
      abstract:
        String(preferred.abstract || "").length >=
        String(alternate.abstract || "").length
          ? preferred.abstract
          : alternate.abstract,
      doi: preferred.doi || alternate.doi || null,
      pmid: preferred.pmid || alternate.pmid || null,
      pmcid: preferred.pmcid || alternate.pmcid || null,
      openalex_id: preferred.openalex_id || alternate.openalex_id || null,
      retrieval_source_name:
        preferred.retrieval_source_name ||
        alternate.retrieval_source_name ||
        null,
      source_url: preferred.source_url || alternate.source_url || null,
      raw_metadata: {
        merged_duplicate_versions: [
          preferred.raw_metadata || preferred,
          alternate.raw_metadata || alternate,
        ],
      },
    },
    intent
  );
}

function collapseDuplicateClinicalRecords(articles = [], intent = {}) {
  const byTitle = new Map();
  const withoutTitle = [];

  for (const rawArticle of articles) {
    const article = annotateSourcePriority(rawArticle, intent);
    const key = normalizeClinicalTitle(article.title);
    if (!key || key.length < 18) {
      withoutTitle.push(article);
      continue;
    }

    if (!byTitle.has(key)) {
      byTitle.set(key, article);
      continue;
    }

    const current = byTitle.get(key);
    const currentQuality = candidateQuality(current, intent);
    const incomingQuality = candidateQuality(article, intent);
    const preferred = incomingQuality > currentQuality ? article : current;
    const alternate = preferred === article ? current : article;

    byTitle.set(
      key,
      mergeDuplicateArticles(preferred, alternate, intent)
    );
  }

  return [...byTitle.values(), ...withoutTitle];
}

function applyProtocolClassification(article = {}, intent = {}) {
  if (!isProtocolEvidence(article)) {
    return annotateSourcePriority(article, intent);
  }

  return annotateSourcePriority(
    {
      ...article,
      study_type: "protocol",
      evidence_level: "preprint_or_unclear",
      evidence_level_label_es: "Protocolo o evidencia no completada",
      evidence_level_label_en: "Protocol or incomplete evidence",
      evidence_level_rank: 1,
      query_relevance_score: Math.min(
        48,
        Number(article.query_relevance_score || 0)
      ),
      reading_priority_score: Math.min(
        38,
        Number(article.reading_priority_score || 0)
      ),
      caution_flags: Array.from(
        new Set([
          ...(article.caution_flags || []),
          "protocolo sin resultados clínicos completados",
        ])
      ),
    },
    intent
  );
}

function applyRelatedGuidelineRelevance(article = {}, intent = {}) {
  const scoped = annotateGuidelineApplicability(article, intent);
  const existing = Number(scoped.query_relevance_score || 0);
  const score = Math.min(64, Math.max(existing, 58));
  const existingPriority = Number(scoped.reading_priority_score || 0);
  const readingPriorityScore = Math.max(
    existingPriority,
    Number(
      (
        score * 0.5 +
        Number(scoped.openphysio_evidence_score || 0) * 0.5
      ).toFixed(2)
    )
  );

  return annotateSourcePriority(
    {
      ...scoped,
      query_relevance_score: score,
      reading_priority_score: readingPriorityScore,
      query_relevance_flags: Array.from(
        new Set([
          ...(scoped.query_relevance_flags || []),
          "guía JOSPT aplicable al componente cervical de la consulta",
        ])
      ),
      query_relevance_limitations: Array.from(
        new Set([
          ...(scoped.query_relevance_limitations || []),
          "no constituye por sí sola evidencia directa sobre cefalea cervicogénica",
        ])
      ),
    },
    intent
  );
}

function applyConditionRelevanceFloor(article = {}, intent = {}) {
  if (isProtocolEvidence(article)) {
    return annotateSourcePriority(article, intent);
  }

  const conditionMatch = getConditionMatch(article, intent);
  const relatedJosptGuideline =
    isRelatedJosptGuidelineForIntent(article, intent);

  if (!conditionMatch.matches && relatedJosptGuideline) {
    return applyRelatedGuidelineRelevance(article, intent);
  }

  if (!conditionMatch.matches) {
    return annotateSourcePriority(article, intent);
  }

  const allMatched =
    conditionMatch.group_count > 0 &&
    conditionMatch.matched_count === conditionMatch.group_count;
  const allMatchedInTitle =
    conditionMatch.group_count > 0 &&
    conditionMatch.title_matched_count === conditionMatch.group_count;

  let floor = 45;
  if (allMatched) floor = 58;
  if (allMatchedInTitle) floor = 68;
  if (isPhysiotherapyFocused(article)) floor += 4;

  const existing = Number(article.query_relevance_score || 0);
  const score = Math.min(100, Math.max(existing, floor));
  const existingPriority = Number(article.reading_priority_score || 0);
  const readingPriorityScore = Math.max(
    existingPriority,
    Number(
      (
        score * 0.55 +
        Number(article.openphysio_evidence_score || 0) * 0.45
      ).toFixed(2)
    )
  );

  return annotateSourcePriority(
    {
      ...article,
      condition_match: conditionMatch,
      query_relevance_score: score,
      reading_priority_score: readingPriorityScore,
      query_relevance_flags: Array.from(
        new Set([
          ...(article.query_relevance_flags || []),
          allMatched
            ? "coincide con todos los conceptos clínicos consultados"
            : "coincide parcialmente con la condición consultada",
        ])
      ),
    },
    intent
  );
}

function selectEvidenceForResponse(
  articles = [],
  intent = {},
  { limit = 20 } = {}
) {
  const originalCount = articles.length;
  const conditionFiltered = articles.filter((article) => {
    const conditionMatch = getConditionMatch(article, intent);
    const relatedJosptGuideline =
      isRelatedJosptGuidelineForIntent(article, intent);

    if (!conditionMatch.matches && !relatedJosptGuideline) return false;
    if (hasUnrequestedCompetingHeadacheEtiology(article, intent)) return false;
    return true;
  });

  const deduplicated = collapseDuplicateClinicalRecords(
    conditionFiltered,
    intent
  );
  const classified = deduplicated
    .map((article) => applyProtocolClassification(article, intent))
    .map((article) => applyConditionRelevanceFloor(article, intent));

  const physiotherapyFocused = classified.filter(isPhysiotherapyFocused);
  const selectedPool =
    physiotherapyFocused.length >= 2 ? physiotherapyFocused : classified;

  const selected = selectedPool
    .sort((left, right) => {
      const protocolDifference =
        Number(isProtocolEvidence(left)) - Number(isProtocolEvidence(right));
      if (protocolDifference !== 0) return protocolDifference;

      const sourceTierDifference =
        getPreferredSourcePriority(right).tier -
        getPreferredSourcePriority(left).tier;
      if (sourceTierDifference !== 0) return sourceTierDifference;

      const priorityDifference =
        Number(right.reading_priority_score || 0) -
        Number(left.reading_priority_score || 0);
      if (priorityDifference !== 0) return priorityDifference;

      return candidateQuality(right, intent) - candidateQuality(left, intent);
    })
    .slice(0, Math.max(1, Number(limit) || 20));

  return {
    articles: selected,
    diagnostics: {
      version: "1.2.0",
      source_priority_version: "1.1.0",
      original_count: originalCount,
      condition_filtered_count: conditionFiltered.length,
      duplicate_collapsed_count:
        conditionFiltered.length - deduplicated.length,
      protocol_count: selected.filter(isProtocolEvidence).length,
      jospt_guideline_count: selected.filter(
        (article) =>
          getPreferredSourcePriority(article).key === "jospt_guideline"
      ).length,
      related_cervical_jospt_count: selected.filter(
        (article) =>
          article.guideline_applicability ===
          "related_cervical_component"
      ).length,
      cochrane_count: selected.filter(
        (article) =>
          getPreferredSourcePriority(article).key === "cochrane_review"
      ).length,
      pubmed_count: selected.filter(
        (article) =>
          getPreferredSourcePriority(article).key === "pubmed_evidence" ||
          article.retrieval_source_name === "PubMed" ||
          Boolean(article.pmid)
      ).length,
      selected_count: selected.length,
    },
  };
}

module.exports = {
  isProtocolEvidence,
  isPhysiotherapyFocused,
  hasUnrequestedCompetingHeadacheEtiology,
  collapseDuplicateClinicalRecords,
  selectEvidenceForResponse,
};
