const { shouldKeepForPhysiotherapySearch } = require("../services/evidenceLevel");

const express = require("express");
const router = express.Router();

const { parseResearchIntent, generateResearchAnswer, generateClinicalTakeaway } = require("../services/deepseek");
const { searchEuropePmc } = require("../services/europePmc");
const { searchOpenAlex } = require("../services/openAlex");
const { searchCrossref } = require("../services/crossref");
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

router.post("/search", async (req, res, next) => {
  try {
    const { query, userId = null, sessionId = null, filters = {}, limit } = req.body || {};

    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "query is required" });
    }

    const resultLimit = Math.min(Number(limit || process.env.DEFAULT_RESULT_LIMIT || 10), 20);

    const intent = await parseResearchIntent(query);
    const normalizedQuery = intent.normalized_query || query.toLowerCase().trim();
    const queryHash = hashQuery(JSON.stringify({ normalizedQuery, filters, resultLimit }));

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

    const [europePmcResults, openAlexResults, crossrefResults] = await Promise.allSettled([
      searchEuropePmc(searchText, resultLimit),
      searchOpenAlex(searchText, resultLimit),
      searchCrossref(searchText, resultLimit),
    ]);

    const rawResults = [
      ...(europePmcResults.status === "fulfilled" ? europePmcResults.value : []),
      ...(openAlexResults.status === "fulfilled" ? openAlexResults.value : []),
      ...(crossrefResults.status === "fulfilled" ? crossrefResults.value : []),
    ];

    const normalized = rawResults
      .map((item) => normalizeArticle(item, intent))
      .filter((article) => article.title);

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
      "non-specific low back pain"
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
    "training"
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

    const answer = await generateResearchAnswer({
      originalQuery: query,
      intent,
      articles: savedArticles.slice(0, 10),
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
 evidence_level: article.evidence_level,
evidence_level_label_es: article.evidence_level_label_es,
evidence_level_label_en: article.evidence_level_label_en,
evidence_level_rank: article.evidence_level_rank,
physiotherapy_relevance_score: article.physiotherapy_relevance_score,
physiotherapy_terms: article.physiotherapy_terms,
is_physiotherapy_relevant: article.is_physiotherapy_relevant,
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
