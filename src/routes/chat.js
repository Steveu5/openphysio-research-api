const express = require("express");

const {
  generateClinicalChatAnswer,
} = require("../services/deepseek");
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

const router = express.Router();

function buildChatSources(articles = []) {
  return articles.slice(0, 4).map((article) => ({
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

      const reply = await generateClinicalChatAnswer({
        question: userQuestion,
        intent: evidence.intent,
        articles: evidence.articles.slice(0, 8),
        messages,
      });

      return res.json({
        reply,
        sources: buildChatSources(evidence.articles),
        queryId: evidence.queryId,
        evidenceQuery,
        searchStrategy: evidence.intent,
        appliedFilters: evidence.appliedFilters,
        evidence_count: evidence.articles.length,
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
