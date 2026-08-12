const express = require("express");

const {
  generateStructuredClinicalChatAnswer,
} = require("../services/structuredEvidenceResponse");
const {
  sanitizeStructuredChatResponse,
} = require("../services/chatClaimSafety");
const {
  refineStructuredClinicalChatFinal,
  renderConciseChatReply,
  injectChatEvidenceSynthesisIntoReply,
} = require("../services/chatFinalRefinement");
const {
  isBroadKneeQuestion,
  applyChatContinuationGuidance,
} = require("../services/chatContinuationGuidance");
const {
  selectEvidenceForResponse,
} = require("../services/evidenceSelectionGuard");
const {
  refineResearchResultsFinal,
} = require("../services/researchFinalRefinement");
const {
  isNeckIntent,
} = require("../services/sourcePriority");
const {
  getLibraryGuideRecommendations,
} = require("../services/libraryGuideRecommendations");
const {
  combineEvidenceWithLibrary,
  prioritizeLibraryGuides,
  getEvidenceBasisIncludingLibrary,
  getLibraryRecommendations,
  attachLibraryResourcesToCitations,
} = require("../services/libraryEvidenceIntegration");
const {
  searchEvidence,
} = require("../services/evidenceSearchEngine");
const {
  buildContextualEvidenceQuery,
} = require("../services/chatQueryContext");
const {
  reserveChatQuota,
  releaseChatQuota,
} = require("../services/chatQuota");
const {
  getResearchSystemMetadata,
} = require("../config/researchSystemVersion");
const {
  requireAuthenticatedUser,
} = require("../middleware/requireAuthenticatedUser");
const {
  requireActiveSubscription,
} = require("../middleware/requireActiveSubscription");
const {
  chatUserRateLimit,
} = require("../middleware/rateLimit");

const router = express.Router();

function detectResponseLanguage(question = "", intent = {}) {
  const language = String(intent.language || "").toLowerCase();
  if (language === "en") return "en";
  if (language === "es") return "es";

  return /[áéíóúñ¿¡]|\b(?:dolor|paciente|tratamiento|ejercicio|cuello|cabeza)\b/i.test(
    String(question || "")
  )
    ? "es"
    : "en";
}

function buildChatSources(articles = []) {
  return articles.slice(0, 4).map((article, index) => ({
    source_index: index + 1,
    id: article.id,
    title: article.title,
    year: article.year,
    journal: article.journal,
    study_type: article.study_type,
    doi: article.doi,
    pmid: article.pmid,
    source_url: article.source_url,
    source_name: article.source_name,
    retrieval_source_name: article.retrieval_source_name,
    preferred_source_tier: article.preferred_source_tier,
    preferred_source_key: article.preferred_source_key,
    preferred_source_label_es: article.preferred_source_label_es,
    preferred_source_label_en: article.preferred_source_label_en,
    guideline_applicability: article.guideline_applicability,
    guideline_scope_label_es: article.guideline_scope_label_es,
    guideline_scope_label_en: article.guideline_scope_label_en,
    guideline_scope_note_es: article.guideline_scope_note_es,
    guideline_scope_note_en: article.guideline_scope_note_en,
    library_resource: article.library_resource || null,
    evidence_level: article.evidence_level,
    evidence_level_label_es: article.evidence_level_label_es,
    evidence_level_label_en: article.evidence_level_label_en,
    reading_priority_score: article.reading_priority_score,
    query_relevance_score: article.query_relevance_score,
  }));
}

function buildResearchReferralQuery(question = "", intent = {}) {
  if (isNeckIntent(intent)) {
    return "Guía clínica JOSPT/AOPT para dolor cervical y evidencia sobre cefalea cervicogénica: evaluación, ejercicio terapéutico, terapia manual y resultados clínicos";
  }

  const condition = intent.condition || intent.normalized_query || question;
  const intervention = intent.intervention || "fisioterapia";
  const population = intent.population || "adultos";
  return `${condition}: ${intervention}, evaluación clínica y evidencia en ${population}`;
}

function buildResearchReferral({ question, intent, language }) {
  const query = buildResearchReferralQuery(question, intent);
  const href = `/research?query=${encodeURIComponent(
    query
  )}&autosearch=1&from=chat`;
  const isEnglish = language === "en";

  return {
    recommended: true,
    query,
    href,
    title: isEnglish
      ? "Expand in Research"
      : "Ampliar en Research",
    description: isEnglish
      ? "Open the full search, clinical guide, and prioritized external evidence."
      : "Abre la búsqueda completa, la guía clínica y la evidencia externa priorizada.",
  };
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

router.post(
  "/evidence-answer",
  requireAuthenticatedUser,
  chatUserRateLimit,
  requireActiveSubscription,
  async (req, res, next) => {
    let reservation = null;

    try {
      const {
        question,
        chatInput,
        message,
        messages = [],
        limit = 8,
        filters = {},
        sessionId = null,
      } = req.body || {};

      const userQuestion = question || chatInput || message;

      if (!userQuestion || typeof userQuestion !== "string") {
        return res.status(400).json({ error: "question is required" });
      }

      const quotaReservation = await reserveChatQuota(req.user.id);
      reservation = quotaReservation.reservation;

      const evidenceQuery = buildContextualEvidenceQuery({
        question: userQuestion,
        messages,
      });

      const evidence = await searchEvidence({
        userId: req.user.id,
        query: evidenceQuery,
        sessionId,
        filters,
        limit,
      });
      const language = detectResponseLanguage(userQuestion, evidence.intent);
      const broadKnee = isBroadKneeQuestion(userQuestion, evidence.intent);
      const libraryResult = await getLibraryGuideRecommendations({
        query: userQuestion,
        intent: evidence.intent,
        language,
        limit: 3,
        userEmail: req.user.email,
      });
      const libraryGuides = eligibleLibraryGuides(
        libraryResult.guides,
        broadKnee
      );
      const combinedArticles = combineEvidenceWithLibrary(
        evidence.articles,
        libraryGuides.slice(0, 1)
      );

      const selection = selectEvidenceForResponse(
        combinedArticles,
        evidence.intent,
        { limit: 10 }
      );
      const qualitySelection = refineResearchResultsFinal(
        selection.articles,
        evidence.intent,
        {
          query: evidenceQuery,
          limit: 4,
        }
      );
      const citedArticles = prioritizeLibraryGuides(
        qualitySelection.articles
      ).slice(0, 4);
      const citedArticlesWithLibraryLinks =
        attachLibraryResourcesToCitations(
          citedArticles,
          libraryResult.linkableGuides || libraryResult.guides
        ).map((article, index) => ({
          ...article,
          source_index: index + 1,
        }));
      const libraryCitationLinksApplied =
        citedArticlesWithLibraryLinks.filter(
          (article, index) =>
            !citedArticles[index]?.library_resource &&
            Boolean(article?.library_resource)
        ).length;
      const answer = await generateStructuredClinicalChatAnswer({
        question: userQuestion,
        intent: evidence.intent,
        articles: citedArticles,
        messages,
      });
      const safeStructured = sanitizeStructuredChatResponse(answer.structured, {
        language,
        confidence: answer.confidence,
      });
      const refinedStructured = refineStructuredClinicalChatFinal(
        safeStructured,
        citedArticles,
        language,
        {
          question: userQuestion,
          intent: evidence.intent,
        }
      );
      const finalStructured = applyChatContinuationGuidance({
        structured: refinedStructured,
        question: userQuestion,
        intent: evidence.intent,
        articles: citedArticles,
        language,
      });
      const evidenceBasis = getEvidenceBasisIncludingLibrary(
        citedArticles,
        language
      );
      const libraryRecommendations = getLibraryRecommendations(
        citedArticlesWithLibraryLinks
      );
      const renderedReply = renderConciseChatReply(
        finalStructured,
        language
      );
      const safeReply = injectChatEvidenceSynthesisIntoReply(
        renderedReply,
        citedArticles,
        language,
        { markdown: true }
      );
      const researchReferral = buildResearchReferral({
        question: userQuestion,
        intent: evidence.intent,
        language,
      });

      return res.json({
        reply: safeReply,
        structuredResponse: finalStructured,
        followUpOptions: finalStructured.follow_up_options || [],
        confidence: finalStructured.confidence,
        evidenceBasis,
        libraryRecommendations,
        libraryGuideDiagnostics: libraryResult.diagnostics,
        libraryGuideIntegrationVersion: "2.0.0",
        libraryCitationLinksApplied,
        researchReferral,
        citationStyle: "numeric_source_index",
        sources: buildChatSources(citedArticlesWithLibraryLinks),
        queryId: evidence.queryId,
        evidenceQuery,
        searchStrategy: evidence.intent,
        appliedFilters: evidence.appliedFilters,
        evidence_count: citedArticles.length,
        retrieved_evidence_count: evidence.articles.length,
        evidenceSelection: selection.diagnostics,
        evidenceSelectionVersion: selection.diagnostics.version,
        resultQuality: qualitySelection.diagnostics,
        resultQualityVersion: qualitySelection.diagnostics.version,
        chatFinalRefinementVersion: "1.3.0",
        chatContinuationGuidanceVersion: "1.1.0",
        broadKneeScopeGuardApplied: broadKnee,
        sourcePriorityVersion: "1.1.0",
        cachedEvidence: evidence.cached,
        researchSystem: getResearchSystemMetadata(),
        quota: quotaReservation.quota,
      });
    } catch (error) {
      if (reservation && error.code !== "CHAT_QUOTA_EXCEEDED") {
        await releaseChatQuota(reservation).catch((releaseError) => {
          console.warn("Chat quota release error:", releaseError.message);
        });
      }

      return next(error);
    }
  }
);

module.exports = router;
