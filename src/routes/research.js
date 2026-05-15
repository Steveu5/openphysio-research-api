const { shouldKeepForPhysiotherapySearch } = require("../services/evidenceLevel");

const express = require("express");
const router = express.Router();

const { parseResearchIntent, generateResearchAnswer, generateClinicalTakeaway } = require("../services/deepseek");
const { searchEuropePmc } = require("../services/europePmc");
const { searchOpenAlex } = require("../services/openAlex");
const { searchCrossref } = require("../services/crossref");
const { searchPubMed } = require("../services/pubmed");
const { buildPreferredGuidelineQueries } = require("../services/preferredGuidelineSearch");
const {
  getCache,
  setCache,
  saveSearchQuery,
  upsertArticles,
  saveSearchResults,
  saveArticle,
  getSavedArticles,
} = require("../services/supabase");
const { normalizeArticle } = require("../services/normalize");
const { rankArticles } = require("../services/ranking");
const { hashQuery } = require("../utils/hash");

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
  const incomingHasBetterSource = sourcePriority(incoming.source_name) > sourcePriority(current.source_name);

  const base = incomingHasBetterAbstract || incomingHasBetterSource
    ? { ...current, ...incoming }
    : { ...incoming, ...current };

  return {
    ...base,
    doi: current.doi || incoming.doi || null,
    pmid: current.pmid || incoming.pmid || null,
    pmcid: current.pmcid || incoming.pmcid || null,
    openalex_id: current.openalex_id || incoming.openalex_id || null,
    abstract: incomingHasBetterAbstract ? incoming.abstract : current.abstract || incoming.abstract || null,
    open_access: Boolean(current.open_access || incoming.open_access),
    source_url:
      (current.pmid || incoming.pmid) ? `https://pubmed.ncbi.nlm.nih.gov/${current.pmid || incoming.pmid}/` :
      current.source_url || incoming.source_url || null,
    raw_metadata: {
      merged_sources: [current.source_name, incoming.source_name].filter(Boolean),
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

async function runSupplementalPreferredGuidelineSearch(intent, originalQuery, limit) {
  const queries = buildPreferredGuidelineQueries(intent, originalQuery);
  if (!queries.length) return [];

  const results = await Promise.allSettled(
    queries.map(async (supplementalQuery) => {
      const [pubmed, openalex] = await Promise.allSettled([
        searchPubMed(supplementalQuery, Math.min(5, limit)),
        searchOpenAlex(supplementalQuery, Math.min(5, limit)),
      ]);

      return [
        ...(pubmed.status === "fulfilled" ? pubmed.value : []),
        ...(openalex.status === "fulfilled" ? openalex.value : []),
      ];
    })
  );

  return results.flatMap((item) => item.status === "fulfilled" ? item.value : []);
}

router.post("/search", async (req, res, next) => {
  try {
    const { query, userId = null, sessionId = null, filters = {}, limit } = req.body || {};

    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "query is required" });
    }

    const resultLimit = Math.min(Number(limit || process.env.DEFAULT_RESULT_LIMIT || 10), 20);

    const intent = await parseResearchIntent(query);
    const normalizedQuery = intent.normalized_query || query.toLowerCase().trim();
    const queryHash = hashQuery(JSON.stringify({ normalizedQuery, filters, resultLimit, preferred_guidelines: true }));

    const cached = await getCache(queryHash);
    if (cached) {
      return res.json({
        ...cached.response_json,
        cached: true,
      });
    }

    const queryRecord = await saveSearchQuery({
      userId,
      sessionId,
      queryText: query,
      normalizedQuery,
      parsedQuery: intent,
      queryLanguage: intent.language || null,
    });

    const searchText = intent.boolean_query || intent.search_query || normalizedQuery || query;

    const [europePmcResults, openAlexResults, crossrefResults, pubMedResults, preferredGuidelineResults] = await Promise.allSettled([
      searchEuropePmc(searchText, resultLimit),
      searchOpenAlex(searchText, resultLimit),
      searchCrossref(searchText, resultLimit),
      searchPubMed(searchText, resultLimit),
      runSupplementalPreferredGuidelineSearch(intent, query, resultLimit),
    ]);

    const rawResults = [
      ...(europePmcResults.status === "fulfilled" ? europePmcResults.value : []),
      ...(openAlexResults.status === "fulfilled" ? openAlexResults.value : []),
      ...(crossrefResults.status === "fulfilled" ? crossrefResults.value : []),
      ...(pubMedResults.status === "fulfilled" ? pubMedResults.value : []),
      ...(preferredGuidelineResults.status === "fulfilled" ? preferredGuidelineResults.value : []),
    ];

    const normalized = deduplicateArticles(
      rawResults
        .map((item) => normalizeArticle(item, intent))
        .filter((article) => article.title)
    );

    const hasExerciseIntent =
      String(intent.intervention || "").toLowerCase().includes("exercise") ||
      (intent.search_terms || []).some((term) =>
        String(term || "").toLowerCase().includes("exercise")
      );

    const filtered = normalized.filter((article) => {
      const text = `${article.title || ""} ${article.abstract || ""}`.toLowerCase();

      if (intent.condition) {
        const conditionTerms = [
          String(intent.condition || "").toLowerCase(),
          "chronic low back pain",
          "low back pain",
          "lumbar pain",
          "nonspecific low back pain",
          "non-specific low back pain",
        ];

        const matchesCondition = conditionTerms.some((term) =>
          term && text.includes(term)
        );

        if (!matchesCondition) return false;
      }

      if (!hasExerciseIntent) return true;

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

    const physiotherapyFiltered = filtered.filter((article) =>
      shouldKeepForPhysiotherapySearch(article, intent)
    );

    // Fallback: si el filtro fisioterapéutico queda demasiado estricto,
    // usamos los resultados filtrados originales para no dejar la búsqueda vacía.
    const finalPool = physiotherapyFiltered.length >= 3
      ? physiotherapyFiltered
      : filtered;

    const ranked = rankArticles(finalPool, intent)
      .slice(0, resultLimit);

    const savedArticles = await upsertArticles(ranked);

    if (queryRecord?.id && savedArticles.length) {
      await saveSearchResults(queryRecord.id, savedArticles);
    }

    // Limited background takeaway generation for top 3 to control cost.
    for (const article of savedArticles.slice(0, 3)) {
      if (!article.clinical_takeaway && article.abstract) {
        generateClinicalTakeaway(article)
          .then(() => {})
          .catch((err) => console.warn("Takeaway background error:", err.message));
      }
    }

    // We may show up to 20 articles in the UI, but the AI answer only analyzes
    // the top 10 by default to control token cost and response latency.
    // Adjust ANSWER_ARTICLE_LIMIT in Dokploy if a deeper synthesis is needed.
    const answerArticleLimit = Number(process.env.ANSWER_ARTICLE_LIMIT || 10);
    const answerArticles = savedArticles.slice(
      0,
      Math.min(answerArticleLimit, resultLimit, 12)
    );

    const answer = await generateResearchAnswer({
      originalQuery: query,
      intent,
      articles: answerArticles,
    });

    const publicArticles = savedArticles.map((article) => ({
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
      source_url: article.source_url,
      open_access: article.open_access,
      pedro_score: article.pedro_score,
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
    }));

    const response = {
      reply: answer,
      articles: publicArticles,
      searchStrategy: intent,
      cached: false,
    };

    await setCache({
      queryHash,
      normalizedQuery,
      parsedQuery: intent,
      responseJson: response,
      resultsJson: publicArticles,
    });

    res.json(response);
  } catch (error) {
    next(error);
  }
});

router.post("/save", async (req, res, next) => {
  try {
    const { userId, articleId, collectionName = "General", notes = null } = req.body || {};

    if (!userId || !articleId) {
      return res.status(400).json({ error: "userId and articleId are required" });
    }

    const saved = await saveArticle({
      userId,
      articleId,
      collectionName,
      notes,
    });

    res.json({ saved });
  } catch (error) {
    next(error);
  }
});

router.get("/saved", async (req, res, next) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const saved = await getSavedArticles(userId);
    res.json({ saved });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
