const express = require("express");

const {
  generateStructuredResearchAnswer,
} = require("../services/structuredEvidenceResponse");
const {
  selectEvidenceForResponse,
} = require("../services/evidenceSelectionGuard");
const {
  injectEvidenceBasisIntoReply,
} = require("../services/sourcePriority");
const {
  getLibraryGuideRecommendations,
} = require("../services/libraryGuideRecommendations");
const {
  combineEvidenceWithLibrary,
  getEvidenceBasisIncludingLibrary,
  getLibraryRecommendations,
} = require("../services/libraryEvidenceIntegration");
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

function toResearchResponseArticle(article = {}) {
  return {
    ...toPublicArticle(article),
    library_resource: article.library_resource || null,
    guideline_applicability: article.guideline_applicability || null,
    guideline_scope_label_es: article.guideline_scope_label_es || null,
    guideline_scope_label_en: article.guideline_scope_label_en || null,
    guideline_scope_note_es: article.guideline_scope_note_es || null,
    guideline_scope_note_en: article.guideline_scope_note_en || null,
  };
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
      const language = resolveLanguage(evidence.intent, query);
      const libraryResult = await getLibraryGuideRecommendations({
        query,
        intent: evidence.intent,
        language,
        limit: 2,
      });
      const combinedArticles = combineEvidenceWithLibrary(
        evidence.articles,
        libraryResult.guides
      );

      const selection = selectEvidenceForResponse(
        combinedArticles,
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
      const evidenceBasis = getEvidenceBasisIncludingLibrary(
        answerArticles,
        language
      );
      const reply = injectEvidenceBasisIntoReply(
        answer.reply,
        evidenceBasis,
        language
      );

      const publicArticles = selectedArticles.map(toResearchResponseArticle);
      const libraryRecommendations = getLibraryRecommendations(
        selectedArticles
      );
      const response = {
        reply,
        structuredResponse: answer.structured,
        confidence: answer.confidence,
        evidenceBasis,
        libraryRecommendations,
        libraryGuideDiagnostics: libraryResult.diagnostics,
        libraryGuideIntegrationVersion: "1.0.0",
        citationStyle: "numeric_source_index",
        articles: publicArticles,
        searchStrategy: evidence.intent,
        appliedFilters: evidence.appliedFilters,
        queryId: evidence.queryId,
        evidenceSelection: selection.diagnostics,
        evidenceSelectionVersion: selection.diagnostics.version,
        sourcePriorityVersion: "1.1.0",
        retrieved_evidence_count: evidence.articles.length,
        relevant_evidence_count: selectedArticles.length,
        cached: evidence.cached,
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
