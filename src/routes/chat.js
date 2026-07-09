const express = require("express");

const {
  generateStructuredClinicalChatAnswer,
  renderChatReply,
} = require("../services/structuredEvidenceResponse");
const {
  sanitizeStructuredChatResponse,
} = require("../services/chatClaimSafety");
const {
  selectEvidenceForResponse,
} = require("../services/evidenceSelectionGuard");
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
    evidence_level: article.evidence_level,
    evidence_level_label_es: article.evidence_level_label_es,
    evidence_level_label_en: article.evidence_level_label_en,
    reading_priority_score: article.reading_priority_score,
    query_relevance_score: article.query_relevance_score,
  }));
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

      const selection = selectEvidenceForResponse(
        evidence.articles,
        evidence.intent,
        { limit: 4 }
      );
      const citedArticles = selection.articles.slice(0, 4);
      const answer = await generateStructuredClinicalChatAnswer({
        question: userQuestion,
        intent: evidence.intent,
        articles: citedArticles,
        messages,
      });
      const language = detectResponseLanguage(userQuestion, evidence.intent);
      const safeStructured = sanitizeStructuredChatResponse(answer.structured, {
        language,
        confidence: answer.confidence,
      });
      const safeReply = renderChatReply(
        safeStructured,
        citedArticles,
        language
      );

      return res.json({
        reply: safeReply,
        structuredResponse: safeStructured,
        confidence: answer.confidence,
        citationStyle: "numeric_source_index",
        sources: buildChatSources(citedArticles),
        queryId: evidence.queryId,
        evidenceQuery,
        searchStrategy: evidence.intent,
        appliedFilters: evidence.appliedFilters,
        evidence_count: citedArticles.length,
        retrieved_evidence_count: evidence.articles.length,
        evidenceSelection: selection.diagnostics,
        evidenceSelectionVersion: selection.diagnostics.version,
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
