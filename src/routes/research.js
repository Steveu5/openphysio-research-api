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
  prioritizeLibraryGuides,
  getEvidenceBasisIncludingLibrary,
  getLibraryRecommendations,
} = require("../services/libraryEvidenceIntegration");
const {
  searchEvidence,
  toPublicArticle,
} = require("../services/evidenceSearchEngine");
const {
  runWithSourceDiagnostics,
} = require("../services/sourceDiagnosticsContext");
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

function sourceText(article = {}) {
  return String(
    `${article.retrieval_source_name || ""} ${article.source_name || ""}`
  ).toLowerCase();
}

function countSourceArticles(articles = [], matcher) {
  return articles.filter((article) => matcher(article, sourceText(article))).length;
}

function buildSourceDiagnostics(evidence = {}, liveDiagnostics = []) {
  const articles = Array.isArray(evidence.articles) ? evidence.articles : [];
  const cached = Boolean(evidence.cached);
  const liveBySource = new Map(
    (Array.isArray(liveDiagnostics) ? liveDiagnostics : []).map((item) => [
      item.source,
      item,
    ])
  );
  const statusFor = (count) =>
    cached
      ? "cached"
      : count > 0
        ? "searched"
        : "searched_no_selected_results";

  const sources = [
    {
      source: "pubmed",
      label: "PubMed",
      selected_count: countSourceArticles(
        articles,
        (article, text) => Boolean(article.pmid) || text.includes("pubmed")
      ),
    },
    {
      source: "europe_pmc",
      label: "Europe PMC",
      selected_count: countSourceArticles(
        articles,
        (_article, text) => text.includes("europe pmc")
      ),
    },
    {
      source: "openalex",
      label: "OpenAlex",
      selected_count: countSourceArticles(
        articles,
        (article, text) => Boolean(article.openalex_id) || text.includes("openalex")
      ),
    },
    {
      source: "crossref",
      label: "Crossref",
      selected_count: countSourceArticles(
        articles,
        (_article, text) => text.includes("crossref")
      ),
    },
  ];

  return sources.map((source) => {
    const live = liveBySource.get(source.source);
    return {
      ...source,
      status: cached ? "cached" : live?.status || statusFor(source.selected_count),
      retrieved_count:
        live?.retrieved_count == null ? null : Number(live.retrieved_count),
      duration_ms: live?.duration_ms == null ? null : Number(live.duration_ms),
      error: live?.status === "error" ? live.error || "Source request failed" : null,
      requests:
        live?.requests == null ? (cached ? 0 : 1) : Number(live.requests),
    };
  });
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

      const searchRun = await runWithSourceDiagnostics(() =>
        searchEvidence({
          userId: req.user.id,
          query,
          sessionId,
          filters,
          limit,
          useCache: false,
        })
      );
      const evidence = searchRun.result;
      const language = resolveLanguage(evidence.intent, query);
      const libraryResult = await getLibraryGuideRecommendations({
        query,
        intent: evidence.intent,
        language,
        limit: 2,
        userEmail: req.user.email,
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
      const selectedArticles = prioritizeLibraryGuides(selection.articles);
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
      const sourceDiagnostics = buildSourceDiagnostics(
        evidence,
        searchRun.diagnostics
      );
      const response = {
        reply,
        structuredResponse: answer.structured,
        confidence: answer.confidence,
        evidenceBasis,
        libraryRecommendations,
        libraryGuideDiagnostics: libraryResult.diagnostics,
        libraryGuideIntegrationVersion: "1.0.0",
        sourceDiagnostics,
        sourceDiagnosticsVersion: "1.2.0",
        pubmedSearchScopeVersion: "2.0.0",
        sourceDiagnosticsNote:
          "En PubMed, encontrados indica lo devuelto por NCBI antes del filtrado global; seleccionados indica lo que superó filtros, deduplicación y ranking.",
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
