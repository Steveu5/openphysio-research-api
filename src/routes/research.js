const express = require("express");

const {
  generateStructuredResearchAnswer,
} = require("../services/structuredEvidenceResponse");
const {
  selectEvidenceForResponse,
} = require("../services/evidenceSelectionGuard");
const {
  getEvidenceBasis,
  injectEvidenceBasisIntoReply,
} = require("../services/sourcePriority");
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
const {
  researchUserRateLimit,
} = require("../middleware/rateLimit");

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

function resolveLanguage(intent = {}, query = "") {
  if (String(intent.language || "").toLowerCase() === "en") return "en";
  if (String(intent.language || "").toLowerCase() === "es") return "es";
  return /[áéíóúñ¿¡]|\b(?:dolor|paciente|tratamiento|ejercicio|fisioterapia)\b/i.test(
    String(query || "")
  )
    ? "es"
    : "en";
}

router.post(
  "/search",
  requireAuthenticatedUser,
  researchUserRateLimit,
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

      if (
        evidence.cachedResponse?.structuredResponse &&
        evidence.cachedResponse?.evidenceSelectionVersion === "1.1.0" &&
        evidence.cachedResponse?.sourcePriorityVersion === "1.0.0"
      ) {
        return res.json({
          ...evidence.cachedResponse,
          queryId: evidence.queryId,
          cached: true,
        });
      }

      const selection = selectEvidenceForResponse(
        evidence.articles,
        evidence.intent,
        { limit: evidence.resultLimit }
      );
      const selectedArticles = selection.articles;
      const answerArticleLimit = Number(
        process.env.ANSWER_ARTICLE_LIMIT || 10
      );
      const answerArticles = selectedArticles.slice(
        0,
        Math.min(answerArticleLimit, evidence.resultLimit, 12)
      );

      const answer = await generateStructuredResearchAnswer({
        originalQuery: query,
        intent: evidence.intent,
        articles: answerArticles,
      });
      const language = resolveLanguage(evidence.intent, query);
      const evidenceBasis = getEvidenceBasis(answerArticles, language);
      const reply = injectEvidenceBasisIntoReply(
        answer.reply,
        evidenceBasis,
        language
      );

      const publicArticles = selectedArticles.map(toPublicArticle);
      const response = {
        reply,
        structuredResponse: answer.structured,
        confidence: answer.confidence,
        evidenceBasis,
        citationStyle: "numeric_source_index",
        articles: publicArticles,
        searchStrategy: evidence.intent,
        appliedFilters: evidence.appliedFilters,
        queryId: evidence.queryId,
        evidenceSelection: selection.diagnostics,
        evidenceSelectionVersion: selection.diagnostics.version,
        sourcePriorityVersion: "1.0.0",
        retrieved_evidence_count: evidence.articles.length,
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
