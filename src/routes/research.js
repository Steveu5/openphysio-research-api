const express = require("express");

const {
  generateResearchAnswer,
} = require("../services/deepseek");
const {
  searchEvidence,
  toPublicArticle,
} = require("../services/evidenceSearchEngine");
const { setCache } = require("../services/supabase");
const {
  ensureStoredPedroScoresLoaded,
} = require("../services/storedPedroScores");
const {
  requireAuthenticatedUser,
} = require("../middleware/requireAuthenticatedUser");
const {
  requireActiveSubscription,
} = require("../middleware/requireActiveSubscription");

const router = express.Router();

function refreshStoredPedroScores(_req, _res, next) {
  Promise.resolve()
    .then(() => ensureStoredPedroScoresLoaded())
    .catch((error) => {
      console.warn(
        "Stored PEDro score refresh error:",
        error?.message || error
      );
    });

  next();
}

router.post(
  "/search",
  requireAuthenticatedUser,
  requireActiveSubscription,
  refreshStoredPedroScores,
  async (req, res, next) => {
    try {
      const { query, sessionId = null, filters = {}, limit } = req.body || {};

      const evidence = await searchEvidence({
        userId: req.user.id,
        query,
        sessionId,
        filters,
        limit,
      });

      if (evidence.cachedResponse) {
        return res.json({
          ...evidence.cachedResponse,
          queryId: evidence.queryId,
          cached: true,
        });
      }

      const answerArticleLimit = Number(
        process.env.ANSWER_ARTICLE_LIMIT || 10
      );
      const answerArticles = evidence.articles.slice(
        0,
        Math.min(answerArticleLimit, evidence.resultLimit, 12)
      );

      const answer = await generateResearchAnswer({
        originalQuery: query,
        intent: evidence.intent,
        articles: answerArticles,
      });

      const publicArticles = evidence.articles.map(toPublicArticle);
      const response = {
        reply: answer,
        articles: publicArticles,
        searchStrategy: evidence.intent,
        appliedFilters: evidence.appliedFilters,
        queryId: evidence.queryId,
        cached: false,
      };

      await setCache({
        queryHash: evidence.queryHash,
        normalizedQuery: evidence.normalizedQuery,
        parsedQuery: evidence.intent,
        responseJson: response,
        resultsJson: publicArticles,
      });

      return res.json(response);
    } catch (error) {
      return next(error);
    }
  }
);

module.exports = router;
