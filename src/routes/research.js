const express = require("express");

const {
  generateStructuredResearchAnswer,
  renderResearchReply,
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
  refineResearchResultsFinal,
} = require("../services/researchFinalRefinement");
const {
  refineStructuredResearchAnswerFinal,
} = require("../services/researchAnswerFinalSafety");
const {
  buildSourceDiagnostics,
  buildSearchSummary,
  normalizeJournalName,
} = require("../services/researchSearchSummary");
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
const RESEARCH_DISPLAY_LIMIT = 20;

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

function normalizeDatabaseName(value = "") {
  const raw = String(value || "").trim();
  const normalized = raw.toLowerCase();

  if (!raw) return null;
  if (normalized.includes("pubmed")) return "PubMed";
  if (normalized.includes("europe pmc")) return "Europe PMC";
  if (normalized.includes("openalex")) return "OpenAlex";
  if (
    normalized.includes("crossref") ||
    normalized.includes("cochrane metadata")
  ) {
    return "Crossref";
  }
  if (
    normalized.includes("openphysio") ||
    normalized.includes("library")
  ) {
    return "Biblioteca OpenPhysioAI";
  }

  return raw;
}

function toResearchResponseArticle(article = {}) {
  const publicArticle = toPublicArticle(article);
  const journal = normalizeJournalName(article.journal);
  const databaseName = normalizeDatabaseName(
    article.retrieval_source_name || article.source_name
  );

  return {
    ...publicArticle,
    journal: journal || null,
    journal_display: journal || "Revista no disponible",
    database_name: databaseName,
    journal_name: journal || null,
    bibliographic_metadata:
      article.bibliographic_metadata || (journal ? "complete" : "incomplete"),
    library_resource: article.library_resource || null,
    guideline_applicability: article.guideline_applicability || null,
    guideline_scope_label_es: article.guideline_scope_label_es || null,
    guideline_scope_label_en: article.guideline_scope_label_en || null,
    guideline_scope_note_es: article.guideline_scope_note_es || null,
    guideline_scope_note_en: article.guideline_scope_note_en || null,
    clinical_directness: article.clinical_directness || null,
    evidence_role: article.evidence_role || null,
    query_scope: article.query_scope || null,
    scope_match: article.scope_match || null,
    population_match: article.population_match || null,
    stage_match: article.stage_match || null,
    intervention_match: article.intervention_match || null,
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
      const { query, sessionId = null, filters = {} } = req.body || {};

      const searchRun = await runWithSourceDiagnostics(() =>
        searchEvidence({
          userId: req.user.id,
          query,
          sessionId,
          filters,
          limit: RESEARCH_DISPLAY_LIMIT,
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
        { limit: RESEARCH_DISPLAY_LIMIT + 4 }
      );
      const qualitySelection = refineResearchResultsFinal(
        selection.articles,
        evidence.intent,
        {
          query,
          limit: RESEARCH_DISPLAY_LIMIT,
        }
      );
      const selectedArticles = qualitySelection.articles.map((article) => ({
        ...article,
        journal: normalizeJournalName(article.journal) || null,
      }));
      const answerArticleLimit = Number(
        process.env.ANSWER_ARTICLE_LIMIT || 10
      );
      const answerArticles = selectedArticles.slice(
        0,
        Math.min(answerArticleLimit, RESEARCH_DISPLAY_LIMIT, 12)
      );

      const generatedAnswer = await generateStructuredResearchAnswer({
        originalQuery: query,
        intent: evidence.intent,
        articles: answerArticles,
      });
      const safeAnswer = refineStructuredResearchAnswerFinal(
        generatedAnswer.structured,
        generatedAnswer.confidence,
        answerArticles,
        language
      );
      const evidenceBasis = getEvidenceBasisIncludingLibrary(
        answerArticles,
        language
      );
      const renderedReply = renderResearchReply(
        safeAnswer.structured,
        language
      );
      const reply = injectEvidenceBasisIntoReply(
        renderedReply,
        evidenceBasis,
        language
      );

      const publicArticles = selectedArticles.map(toResearchResponseArticle);
      const libraryRecommendations = getLibraryRecommendations(
        selectedArticles
      );
      const sourceDiagnostics = buildSourceDiagnostics(
        evidence,
        searchRun.diagnostics,
        selectedArticles
      );
      const searchSummary = buildSearchSummary({
        sourceDiagnostics,
        displayedArticles: selectedArticles,
        selectionDiagnostics: selection.diagnostics,
        qualityDiagnostics: qualitySelection.diagnostics,
      });
      const response = {
        reply,
        structuredResponse: safeAnswer.structured,
        confidence: safeAnswer.confidence,
        evidenceBasis,
        libraryRecommendations,
        libraryGuideDiagnostics: libraryResult.diagnostics,
        libraryGuideIntegrationVersion: "1.0.0",
        sourceDiagnostics,
        sourceDiagnosticsVersion: "2.1.0",
        searchSummary,
        searchSummaryVersion: "1.2.0",
        resultQuality: qualitySelection.diagnostics,
        resultQualityVersion: qualitySelection.diagnostics.version,
        researchAnswerSafetyVersion: "1.3.0",
        finalResearchRankingVersion: "1.0.0",
        databaseNormalizationVersion: "1.0.0",
        pubmedSearchScopeVersion: "2.1.0",
        sourceDiversityVersion: "2.1.0",
        displayedArticleLimit: RESEARCH_DISPLAY_LIMIT,
        sourceDiagnosticsNote:
          "Recuperados indica registros devueltos por cada base de datos. Visibles indica la fuente principal del artículo mostrado. Un artículo también puede estar indexado en PubMed sin haber sido recuperado principalmente desde PubMed.",
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
