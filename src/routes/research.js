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

    const ranked = rankArticles(normalized, intent)
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

    const response = {
      reply: answer,
      articles: savedArticles,
      searchStrategy: intent,
      cached: false,
    };

    await setCache({
      queryHash,
      normalizedQuery,
      parsedQuery: intent,
      responseJson: response,
      resultsJson: savedArticles,
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
