const { shouldKeepForPhysiotherapySearch } = require("./evidenceLevel");
const {
  parseResearchIntent,
  generateClinicalTakeaway,
} = require("./deepseek");
const { searchEuropePmc } = require("./europePmc");
const { searchOpenAlex } = require("./openAlex");
const { searchCrossref } = require("./crossref");
const { searchPubMed } = require("./pubmed");
const { searchJosptGuidelines } = require("./josptGuidelineSearch");
const { buildPreferredGuidelineQueries } = require("./preferredGuidelineSearch");
const {
  getConditionMatch,
} = require("./conditionConcepts");
const {
  annotateSourcePriority,
  isRelatedJosptGuidelineForIntent,
} = require("./sourcePriority");
const {
  getCache,
  saveSearchQuery,
  saveSearchSnapshot,
  upsertArticles,
  saveSearchResults,
} = require("./supabase");
const { normalizeArticle } = require("./normalize");
const { rankArticles } = require("./ranking");
const { hashQuery } = require("../utils/hash");
const {
  normalizeResearchFilters,
  articleMatchesResearchFilters,
} = require("../utils/researchFilters");

function normalizeTitleKey(title = "") {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function articleDedupKey(article = {}) {
  if (article.doi) return `doi:${String(article.doi).toLowerCase()}`;
  if (article.pmid) return `pmid:${String(article.pmid)}`;
  if (article.pmcid) return `pmcid:${String(article.pmcid).toLowerCase()}`;

  const titleKey = normalizeTitleKey(article.title);
  if (titleKey && article.year) return `title:${titleKey}:year:${article.year}`;
  if (titleKey) return `title:${titleKey}`;

  return null;
}

function sourcePriority(sourceName = "") {
  const source = String(sourceName).toLowerCase();
  if (source.includes("pubmed")) return 4;
  if (source.includes("europe pmc")) return 3;
  if (source.includes("openalex")) return 2;
  if (source.includes("crossref")) return 1;
  return 0;
}

function mergeArticleRecords(current = {}, incoming = {}) {
  const currentAbstractLength = String(current.abstract || "").length;
  const incomingAbstractLength = String(incoming.abstract || "").length;
  const incomingHasBetterAbstract = incomingAbstractLength > currentAbstractLength;
  const incomingHasBetterSource =
    sourcePriority(incoming.retrieval_source_name || incoming.source_name) >
    sourcePriority(current.retrieval_source_name || current.source_name);
  const incomingHasHigherPreferredTier =
    Number(incoming.preferred_source_tier || 0) >
    Number(current.preferred_source_tier || 0);

  const base =
    incomingHasBetterAbstract ||
    incomingHasBetterSource ||
    incomingHasHigherPreferredTier
      ? { ...current, ...incoming }
      : { ...incoming, ...current };

  return {
    ...base,
    doi: current.doi || incoming.doi || null,
    pmid: current.pmid || incoming.pmid || null,
    pmcid: current.pmcid || incoming.pmcid || null,
    openalex_id: current.openalex_id || incoming.openalex_id || null,
    abstract: incomingHasBetterAbstract
      ? incoming.abstract
      : current.abstract || incoming.abstract || null,
    open_access: Boolean(current.open_access || incoming.open_access),
    retrieval_source_name:
      incomingHasBetterSource
        ? incoming.retrieval_source_name || incoming.source_name
        : current.retrieval_source_name || current.source_name ||
          incoming.retrieval_source_name || incoming.source_name || null,
    targeted_search_strategy:
      current.targeted_search_strategy ||
      incoming.targeted_search_strategy ||
      null,
    preferred_source_tier: Math.max(
      Number(current.preferred_source_tier || 0),
      Number(incoming.preferred_source_tier || 0)
    ),
    preferred_source_key:
      incomingHasHigherPreferredTier
        ? incoming.preferred_source_key
        : current.preferred_source_key || incoming.preferred_source_key || null,
    preferred_source_label_es:
      incomingHasHigherPreferredTier
        ? incoming.preferred_source_label_es
        : current.preferred_source_label_es ||
          incoming.preferred_source_label_es ||
          null,
    preferred_source_label_en:
      incomingHasHigherPreferredTier
        ? incoming.preferred_source_label_en
        : current.preferred_source_label_en ||
          incoming.preferred_source_label_en ||
          null,
    source_url:
      current.pmid || incoming.pmid
        ? `https://pubmed.ncbi.nlm.nih.gov/${current.pmid || incoming.pmid}/`
        : current.source_url || incoming.source_url || null,
    raw_metadata: {
      merged_sources: [
        current.retrieval_source_name || current.source_name,
        incoming.retrieval_source_name || incoming.source_name,
      ].filter(Boolean),
      current: current.raw_metadata || current,
      incoming: incoming.raw_metadata || incoming,
    },
  };
}

function deduplicateArticles(articles = []) {
  const byKey = new Map();

  for (const article of articles) {
    const key = articleDedupKey(article);
    if (!key) continue;

    if (!byKey.has(key)) {
      byKey.set(key, article);
      continue;
    }

    byKey.set(key, mergeArticleRecords(byKey.get(key), article));
  }

  return Array.from(byKey.values());
}

function textIncludesAny(text = "", terms = []) {
  const normalized = String(text || "").toLowerCase();
  return terms.some((term) => normalized.includes(String(term).toLowerCase()));
}

function isEditorialNoise(article = {}) {
  const title = `${article.title || ""}`.toLowerCase().trim();
  const studyType = `${article.study_type || ""}`.toLowerCase();
  const journal = `${article.journal || ""}`.toLowerCase();
  const abstract = `${article.abstract || ""}`.toLowerCase().trim();

  const noisyTitleStarts = [
    "correction:",
    "correction to:",
    "erratum:",
    "erratum to:",
    "response to",
    "reply to",
    "comment on",
    "letter to",
    "editorial:",
  ];

  if (noisyTitleStarts.some((prefix) => title.startsWith(prefix))) return true;

  if (
    textIncludesAny(studyType, [
      "correction",
      "erratum",
      "letter",
      "comment",
      "editorial",
      "news",
      "published erratum",
    ])
  ) {
    return true;
  }

  const abstractLooksEditorial =
    abstract.startsWith("editorial") ||
    abstract.startsWith("editorials") ||
    abstract.includes("this issue of annals includes") ||
    abstract.includes("author, article, and disclosure information") ||
    abstract.includes("previousarticle") ||
    abstract.includes("nextarticle") ||
    abstract.includes("advertisement figuresreferencesrelateddetails");

  if (abstractLooksEditorial) return true;

  const titleLooksCommentary = textIncludesAny(title, [
    "getting from evidence-based recommendations to high-value care",
    "from evidence-based recommendations to high-value care",
  ]);

  if (titleLooksCommentary && journal.includes("annals")) return true;
  if (title.includes("correction") && journal.includes("annals")) return true;

  return false;
}

function articleMatchesCondition(article = {}, intent = {}) {
  return getConditionMatch(article, intent).matches;
}

function isPreferredGuidelineOrPhysioSource(article = {}, intent = {}) {
  const title = `${article.title || ""}`.toLowerCase();
  const abstract = `${article.abstract || ""}`.toLowerCase();
  const journal = `${article.journal || ""}`.toLowerCase();
  const studyType = `${article.study_type || ""}`.toLowerCase();
  const source = `${article.source_name || ""}`.toLowerCase();
  const combined = `${title} ${abstract} ${journal} ${studyType} ${source}`;

  const isGuideline = textIncludesAny(combined, [
    "clinical practice guideline",
    "practice guideline",
    "guideline",
    "recommendations",
    "interventions for the management",
  ]);

  const isPreferredPhysioSource = textIncludesAny(
    `${journal} ${source} ${title}`,
    [
      "journal of orthopaedic and sports physical therapy",
      "j orthop sports phys ther",
      "jospt",
      "academy of orthopaedic physical therapy",
      "american physical therapy association",
      "apta",
      "journal of physiotherapy",
      "physical therapy and rehabilitation journal",
      "nice guideline",
      "american academy of orthopaedic surgeons",
      "aaos",
    ]
  );

  const conditionCompatible =
    articleMatchesCondition(article, intent) ||
    isRelatedJosptGuidelineForIntent(article, intent);

  return (
    (isGuideline || isPreferredPhysioSource) &&
    conditionCompatible
  );
}

async function runSupplementalPreferredGuidelineSearch(
  intent,
  originalQuery,
  limit
) {
  const queries = buildPreferredGuidelineQueries(intent, originalQuery);
  if (!queries.length) return [];

  const results = await Promise.allSettled(
    queries.map(async (supplementalQuery) => {
      const [pubmed, openalex] = await Promise.allSettled([
        searchPubMed(supplementalQuery, Math.min(5, limit), intent.filters),
        searchOpenAlex(supplementalQuery, Math.min(5, limit), intent.filters),
      ]);

      return [
        ...(pubmed.status === "fulfilled" ? pubmed.value : []),
        ...(openalex.status === "fulfilled" ? openalex.value : []),
      ];
    })
  );

  return results.flatMap((item) =>
    item.status === "fulfilled" ? item.value : []
  );
}

function buildEvidenceQueryHash({ normalizedQuery, filters, resultLimit }) {
  return hashQuery(
    JSON.stringify({
      normalizedQuery,
      filters,
      resultLimit,
      preferred_guidelines: true,
      targeted_jospt_guidelines: true,
      source_priority_hierarchy: "1.1.0",
      related_cervical_guideline_fallback: true,
      filter_editorial_noise: true,
      filter_embedded_editorial_pages: true,
      require_condition_for_preferred_guidelines: true,
      separate_article_quality_from_query_relevance: true,
      pedro_score_interpretation: true,
      guided_reading_answer: true,
      multi_concept_condition_matching: "2.0.0",
    })
  );
}

function toPublicArticle(article = {}) {
  return {
    id: article.id,
    title: article.title,
    abstract: article.abstract,
    clinical_takeaway: article.clinical_takeaway,
    doi: article.doi,
    pmid: article.pmid,
    pmcid: article.pmcid,
    openalex_id: article.openalex_id,
    authors_text: article.authors_text,
    journal: article.journal,
    year: article.year,
    publication_date: article.publication_date,
    study_type: article.study_type,
    source_name: article.source_name,
    retrieval_source_name: article.retrieval_source_name,
    targeted_search_strategy: article.targeted_search_strategy,
    preferred_source_tier: article.preferred_source_tier,
    preferred_source_key: article.preferred_source_key,
    preferred_source_label_es: article.preferred_source_label_es,
    preferred_source_label_en: article.preferred_source_label_en,
    guideline_applicability: article.guideline_applicability,
    guideline_scope_label_es: article.guideline_scope_label_es,
    guideline_scope_label_en: article.guideline_scope_label_en,
    guideline_scope_note_es: article.guideline_scope_note_es,
    guideline_scope_note_en: article.guideline_scope_note_en,
    source_url: article.source_url,
    open_access: article.open_access,
    pedro_score: article.pedro_score,
    pedro_score_label: article.pedro_score_label,
    pedro_score_status: article.pedro_score_status,
    pedro_applicability: article.pedro_applicability,
    pedro_quality_boost: article.pedro_quality_boost,
    pedro_explanation: article.pedro_explanation,
    body_region: article.body_region,
    condition: article.condition,
    intervention: article.intervention,
    population: article.population,
    outcome: article.outcome,
    relevance_score: article.relevance_score,
    ranking_reason: article.ranking_reason,
    evidence_level: article.evidence_level,
    evidence_level_label_es: article.evidence_level_label_es,
    evidence_level_label_en: article.evidence_level_label_en,
    evidence_level_rank: article.evidence_level_rank,
    physiotherapy_relevance_score: article.physiotherapy_relevance_score,
    physiotherapy_terms: article.physiotherapy_terms,
    is_physiotherapy_relevant: article.is_physiotherapy_relevant,
    trusted_source_label: article.trusted_source_label,
    trusted_source_score: article.trusted_source_score,
    openphysio_evidence_score: article.openphysio_evidence_score,
    openphysio_priority_label: article.openphysio_priority_label,
    score_breakdown: article.score_breakdown,
    appraisal_flags: article.appraisal_flags,
    caution_flags: article.caution_flags,
    query_relevance_score: article.query_relevance_score,
    query_relevance_flags: article.query_relevance_flags,
    query_relevance_limitations: article.query_relevance_limitations,
    reading_priority_score: article.reading_priority_score,
    condition_match: article.condition_match,
  };
}

async function searchEvidence({
  userId = null,
  query,
  sessionId = null,
  filters = {},
  limit,
  useCache = true,
} = {}) {
  if (!query || typeof query !== "string") {
    const error = new Error("query is required");
    error.status = 400;
    throw error;
  }

  const resultLimit = Math.min(
    Number(limit || process.env.DEFAULT_RESULT_LIMIT || 10),
    20
  );

  const parsedIntent = await parseResearchIntent(query);
  const normalizedFilters = normalizeResearchFilters(
    filters,
    parsedIntent.filters
  );
  const intent = {
    ...parsedIntent,
    filters: normalizedFilters,
  };
  const normalizedQuery =
    intent.normalized_query || query.toLowerCase().trim();
  const queryHash = buildEvidenceQueryHash({
    normalizedQuery,
    filters: normalizedFilters,
    resultLimit,
  });

  const queryRecord = userId
    ? await saveSearchQuery({
        userId,
        sessionId,
        queryText: query,
        normalizedQuery,
        parsedQuery: intent,
        queryLanguage: intent.language || null,
      })
    : null;

  if (useCache) {
    const cached = await getCache(queryHash);
    if (cached) {
      const cachedArticles = Array.isArray(cached.response_json?.articles)
        ? cached.response_json.articles
        : Array.isArray(cached.results_json)
          ? cached.results_json
          : [];

      if (queryRecord?.id && cachedArticles.length) {
        await saveSearchResults(queryRecord.id, cachedArticles);
        await saveSearchSnapshot({
          queryId: queryRecord.id,
          parsedQuery: intent,
          articles: cachedArticles,
          source: "cache_hit",
        });
      }

      return {
        queryId: queryRecord?.id || null,
        queryRecord,
        queryHash,
        normalizedQuery,
        intent,
        appliedFilters: normalizedFilters,
        resultLimit,
        articles: cachedArticles,
        cached: true,
        cachedResponse: cached.response_json || null,
      };
    }
  }

  const searchText =
    intent.boolean_query ||
    intent.search_query ||
    normalizedQuery ||
    query;

  const [
    josptGuidelineResults,
    europePmcResults,
    openAlexResults,
    crossrefResults,
    pubMedResults,
    preferredGuidelineResults,
  ] = await Promise.allSettled([
    searchJosptGuidelines(
      intent,
      query,
      Math.min(8, resultLimit),
      normalizedFilters
    ),
    searchEuropePmc(searchText, resultLimit, normalizedFilters),
    searchOpenAlex(searchText, resultLimit, normalizedFilters),
    searchCrossref(searchText, resultLimit, normalizedFilters),
    searchPubMed(searchText, resultLimit, normalizedFilters),
    runSupplementalPreferredGuidelineSearch(intent, query, resultLimit),
  ]);

  const rawResults = [
    ...(josptGuidelineResults.status === "fulfilled"
      ? josptGuidelineResults.value
      : []),
    ...(europePmcResults.status === "fulfilled" ? europePmcResults.value : []),
    ...(openAlexResults.status === "fulfilled" ? openAlexResults.value : []),
    ...(crossrefResults.status === "fulfilled" ? crossrefResults.value : []),
    ...(pubMedResults.status === "fulfilled" ? pubMedResults.value : []),
    ...(preferredGuidelineResults.status === "fulfilled"
      ? preferredGuidelineResults.value
      : []),
  ];

  const normalized = deduplicateArticles(
    rawResults
      .map((item) => normalizeArticle(item, intent))
      .map((article) => annotateSourcePriority(article, intent))
      .filter((article) => article.title)
      .filter((article) => !isEditorialNoise(article))
  ).filter((article) =>
    articleMatchesResearchFilters(article, normalizedFilters)
  );

  const hasExerciseIntent =
    String(intent.intervention || "").toLowerCase().includes("exercise") ||
    (intent.search_terms || []).some((term) =>
      String(term || "").toLowerCase().includes("exercise")
    );

  const filtered = normalized.filter((article) => {
    const text = `${article.title || ""} ${article.abstract || ""}`.toLowerCase();
    const conditionMatch = getConditionMatch(article, intent);
    const relatedJosptGuideline =
      isRelatedJosptGuidelineForIntent(article, intent);

    if (!conditionMatch.matches && !relatedJosptGuideline) return false;

    if (!hasExerciseIntent) return true;
    if (isPreferredGuidelineOrPhysioSource(article, intent)) return true;

    const exerciseTerms = [
      "exercise",
      "exercise therapy",
      "therapeutic exercise",
      "physical therapy",
      "physiotherapy",
      "rehabilitation",
      "strength",
      "strengthening",
      "resistance",
      "stabilization",
      "stabilisation",
      "motor control",
      "core stability",
      "yoga",
      "pilates",
      "training",
    ];

    return exerciseTerms.some((term) => text.includes(term));
  });

  const physiotherapyFiltered = filtered.filter(
    (article) =>
      shouldKeepForPhysiotherapySearch(article, intent) ||
      isPreferredGuidelineOrPhysioSource(article, intent)
  );

  const finalPool =
    physiotherapyFiltered.length >= 3 ? physiotherapyFiltered : filtered;
  const ranked = rankArticles(finalPool, intent)
    .map((article) => annotateSourcePriority(article, intent))
    .slice(0, resultLimit);
  const savedArticles = await upsertArticles(ranked);

  if (queryRecord?.id && savedArticles.length) {
    await saveSearchResults(queryRecord.id, savedArticles);
    await saveSearchSnapshot({
      queryId: queryRecord.id,
      parsedQuery: intent,
      articles: savedArticles,
      source: "live_search",
    });
  }

  for (const article of savedArticles.slice(0, 3)) {
    if (!article.clinical_takeaway && article.abstract) {
      generateClinicalTakeaway(article).catch((error) =>
        console.warn("Takeaway background error:", error.message)
      );
    }
  }

  return {
    queryId: queryRecord?.id || null,
    queryRecord,
    queryHash,
    normalizedQuery,
    intent,
    appliedFilters: normalizedFilters,
    resultLimit,
    articles: savedArticles,
    cached: false,
    cachedResponse: null,
  };
}

module.exports = {
  searchEvidence,
  toPublicArticle,
  buildEvidenceQueryHash,
  deduplicateArticles,
  isEditorialNoise,
  articleMatchesCondition,
  isPreferredGuidelineOrPhysioSource,
};
