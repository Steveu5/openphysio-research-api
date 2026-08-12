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
  attachLibraryResourcesToCitations,
} = require("../services/libraryEvidenceIntegration");
const {
  refineResearchResultsFinal,
} = require("../services/researchFinalRefinement");
const {
  isBroadKneeQuestion,
} = require("../services/chatContinuationGuidance");
const {
  refineStructuredResearchAnswerFinal,
} = require("../services/researchAnswerFinalSafety");
const {
  refineLibraryGuidesForCervicogenicHeadache,
  getTargetedCervicogenicHeadacheArticles,
  refineCervicogenicHeadacheResults,
  refineCervicogenicHeadacheAnswer,
} = require("../services/cervicogenicHeadacheRefinement");
const {
  finalizeCervicogenicHeadacheArticles,
  finalizeCervicogenicHeadacheAnswer,
} = require("../services/cervicogenicHeadacheFinalPass");
const { rankArticles } = require("../services/ranking");
const {
  buildSourceDiagnostics,
  buildSearchSummary,
  normalizeJournalName,
} = require("../services/researchSearchSummary");
const {
  searchEvidence,
  toPublicArticle,
  deduplicateArticles,
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
const {
  validateResearchRequest,
} = require("../services/requestValidation");
const {
  ensurePubMedRepresentation,
} = require("../services/sourceDiversity");

const router = express.Router();
const RESEARCH_DISPLAY_LIMIT = 20;
const RESEARCH_CANDIDATE_LIMIT = 28;
const MIN_PUBMED_RESULTS_IF_AVAILABLE = 5;

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

function eligibleLibraryGuides(guides = [], broadKnee = false) {
  if (!broadKnee) return guides;

  return (Array.isArray(guides) ? guides : []).filter((guide) => {
    const applicability =
      guide?.library_resource?.applicability ||
      guide?.guideline_applicability ||
      null;
    return applicability === "direct";
  });
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
    source_index:
      Number.isInteger(Number(article.source_index)) &&
      Number(article.source_index) > 0
        ? Number(article.source_index)
        : null,
    journal: journal || null,
    journal_display: journal || "Revista no disponible",
    database_name: databaseName,
    journal_name: journal || null,
    bibliographic_metadata:
      article.bibliographic_metadata || (journal ? "complete" : "incomplete"),
    library_resource: article.library_resource || null,
    library_link_match: article.library_link_match || null,
    is_library_guide: String(article.id || "").startsWith("library:"),
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
      const { query, sessionId, filters } = validateResearchRequest(
        req.body || {}
      );

      const searchRun = await runWithSourceDiagnostics(() =>
        searchEvidence({
          userId: req.user.id,
          query,
          sessionId,
          filters,
          limit: RESEARCH_CANDIDATE_LIMIT,
          useCache: false,
        })
      );
      const evidence = searchRun.result;
      const language = resolveLanguage(evidence.intent, query);
      const broadKnee = isBroadKneeQuestion(query, evidence.intent);

      const [libraryResult, targetedCervicogenicArticles] = await Promise.all([
        getLibraryGuideRecommendations({
          query,
          intent: evidence.intent,
          language,
          limit: 2,
          userEmail: req.user.email,
        }),
        getTargetedCervicogenicHeadacheArticles({
          query,
          intent: evidence.intent,
          limit: 14,
        }),
      ]);

      const refinedLibraryGuides = eligibleLibraryGuides(
        refineLibraryGuidesForCervicogenicHeadache(
          libraryResult.guides,
          query,
          evidence.intent
        ),
        broadKnee
      );
      const rankedTargetedCervicogenicArticles = rankArticles(
        targetedCervicogenicArticles,
        evidence.intent
      );
      const evidenceArticles = deduplicateArticles([
        ...evidence.articles,
        ...rankedTargetedCervicogenicArticles,
      ]);
      const combinedArticles = combineEvidenceWithLibrary(
        evidenceArticles,
        refinedLibraryGuides.slice(0, 1)
      );

      const selection = selectEvidenceForResponse(
        combinedArticles,
        evidence.intent,
        { limit: RESEARCH_CANDIDATE_LIMIT }
      );
      const baseQualitySelection = refineResearchResultsFinal(
        selection.articles,
        evidence.intent,
        {
          query,
          limit: RESEARCH_CANDIDATE_LIMIT,
        }
      );
      const qualitySelection = refineCervicogenicHeadacheResults(
        baseQualitySelection.articles,
        query,
        evidence.intent,
        {
          limit: RESEARCH_CANDIDATE_LIMIT,
          baseDiagnostics: baseQualitySelection.diagnostics,
        }
      );
      const finalQualitySelection = finalizeCervicogenicHeadacheArticles(
        qualitySelection.articles,
        query,
        evidence.intent,
        qualitySelection.diagnostics
      );
      const sourceDiversitySelection = ensurePubMedRepresentation(
        finalQualitySelection.articles,
        finalQualitySelection.articles,
        {
          displayLimit: RESEARCH_DISPLAY_LIMIT,
          minimum: MIN_PUBMED_RESULTS_IF_AVAILABLE,
        }
      );
      const selectedArticles = sourceDiversitySelection.articles.map(
        (article) => ({
          ...article,
          journal: normalizeJournalName(article.journal) || null,
        })
      );
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
      const baseSafeAnswer = refineStructuredResearchAnswerFinal(
        generatedAnswer.structured,
        generatedAnswer.confidence,
        answerArticles,
        language
      );
      const refinedCervicogenicAnswer = refineCervicogenicHeadacheAnswer(
        baseSafeAnswer,
        answerArticles,
        query,
        evidence.intent,
        language
      );
      const safeAnswer = finalizeCervicogenicHeadacheAnswer(
        refinedCervicogenicAnswer,
        answerArticles,
        query,
        evidence.intent,
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

      const selectedArticlesWithLibraryLinks =
        attachLibraryResourcesToCitations(
          selectedArticles,
          libraryResult.linkableGuides || libraryResult.guides
        ).map((article, index) => ({
          ...article,
          source_index: index + 1,
        }));
      const libraryCitationLinksApplied =
        selectedArticlesWithLibraryLinks.filter(
          (article, index) =>
            !selectedArticles[index]?.library_resource &&
            Boolean(article?.library_resource)
        ).length;
      const publicArticles = selectedArticlesWithLibraryLinks.map(
        toResearchResponseArticle
      );
      const libraryRecommendations = getLibraryRecommendations(
        selectedArticlesWithLibraryLinks
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
        qualityDiagnostics: finalQualitySelection.diagnostics,
      });
      const response = {
        reply,
        structuredResponse: safeAnswer.structured,
        confidence: safeAnswer.confidence,
        evidenceBasis,
        libraryRecommendations,
        libraryGuideDiagnostics: {
          ...libraryResult.diagnostics,
          cervicogenic_headache_refinement_version: "1.1.0",
        },
        libraryGuideIntegrationVersion: "2.0.0",
        libraryCitationLinksApplied,
        broadKneeScopeGuardApplied: broadKnee,
        sourceDiagnostics,
        sourceDiagnosticsVersion: "2.1.0",
        searchSummary,
        searchSummaryVersion: "1.4.0",
        resultQuality: finalQualitySelection.diagnostics,
        resultQualityVersion: finalQualitySelection.diagnostics.version,
        researchAnswerSafetyVersion: "1.5.0",
        finalResearchRankingVersion: "1.2.0",
        cervicogenicHeadacheRefinementVersion: "1.1.0",
        databaseNormalizationVersion: "1.0.0",
        pubmedSearchScopeVersion: "2.2.0",
        sourceDiversityVersion: "2.1.0",
        sourceDiversity: sourceDiversitySelection.diagnostics,
        displayedArticleLimit: RESEARCH_DISPLAY_LIMIT,
        sourceDiagnosticsNote:
          "Recuperados indica los registros devueltos por cada base de datos. Visibles indica lo que aparece entre los artículos relevantes mostrados y cuál fue su fuente principal. Un artículo también puede estar indexado en PubMed sin haber sido recuperado principalmente desde PubMed.",
        citationStyle: "numeric_source_index",
        researchResponseStructureVersion: "2.0.0",
        articles: publicArticles,
        searchStrategy: evidence.intent,
        appliedFilters: evidence.appliedFilters,
        queryId: evidence.queryId,
        evidenceSelection: selection.diagnostics,
        evidenceSelectionVersion: selection.diagnostics.version,
        sourcePriorityVersion: "1.1.0",
        retrieved_evidence_count: evidenceArticles.length,
        relevant_evidence_count: selectedArticles.length,
        cached: false,
      };

      void setCache({
        queryHash: evidence.queryHash,
        normalizedQuery: evidence.normalizedQuery,
        parsedQuery: evidence.intent,
        responseJson: response,
        resultsJson: publicArticles,
      }).catch((cacheError) => {
        console.warn(
          "Research cache persistence delayed:",
          cacheError?.message || cacheError
        );
      });

      return res.json(response);
    } catch (error) {
      return next(error);
    }
  }
);

module.exports = router;
