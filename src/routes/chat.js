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
  getResearchSystemMetadata,
} = require("../config/researchSystemVersion");

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

router.post("/evidence-answer", async (req, res, next) => {
  try {
    const {
      question,
      chatInput,
      message,
      messages = [],
      limit = 8,
      filters = {},
      sessionId = null,
      userId = null,
    } = req.body || {};

    const userQuestion = question || chatInput || message;

    if (!userQuestion || typeof userQuestion !== "string") {
      return res.status(400).json({ error: "question is required" });
    }

    const evidenceQuery = buildContextualEvidenceQuery({
      question: userQuestion,
      messages,
    });

    const evidence = await searchEvidence({
      userId,
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
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
