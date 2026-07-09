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
  getEvidenceBasis,
  injectEvidenceBasisIntoReply,
  isNeckIntent,
} = require("../services/sourcePriority");
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

function buildResearchReferral({
  question,
  intent,
  confidence,
  selection,
  evidenceBasis,
  language,
}) {
  const shouldRefer =
    confidence?.level_key === "limited" ||
    Number(selection?.diagnostics?.selected_count || 0) < 3 ||
    Number(selection?.diagnostics?.protocol_count || 0) > 0 ||
    evidenceBasis?.applicability === "related_cervical_component" ||
    evidenceBasis?.available === false;

  if (!shouldRefer) {
    return {
      recommended: false,
      query: null,
      href: null,
      title: null,
      description: null,
    };
  }

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
      ? "Expand this search in Research"
      : "Ampliar esta búsqueda en Research",
    description: isEnglish
      ? "Research will run a broader search to compare the JOSPT guideline, completed reviews, PubMed studies, filters, and the audit trail."
      : "Research realizará una búsqueda más amplia para comparar la guía JOSPT, revisiones completadas, estudios de PubMed, filtros y la auditoría.",
  };
}

function appendResearchReferral(reply = "", referral = {}, language = "es") {
  if (!referral.recommended || !referral.href) return String(reply || "").trim();

  const heading =
    language === "en"
      ? "**Continue in Research**"
      : "**Continuar en Research**";
  const link = `[${referral.title}](${referral.href})`;

  return `${String(reply || "").trim()}\n\n${heading}\n${
    referral.description
  }\n\n${link}`;
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
      const evidenceBasis = getEvidenceBasis(citedArticles, language);
      const renderedReply = renderChatReply(
        safeStructured,
        citedArticles,
        language
      );
      const basisReply = injectEvidenceBasisIntoReply(
        renderedReply,
        evidenceBasis,
        language,
        { markdown: true }
      );
      const researchReferral = buildResearchReferral({
        question: userQuestion,
        intent: evidence.intent,
        confidence: answer.confidence,
        selection,
        evidenceBasis,
        language,
      });
      const safeReply = appendResearchReferral(
        basisReply,
        researchReferral,
        language
      );

      return res.json({
        reply: safeReply,
        structuredResponse: safeStructured,
        confidence: answer.confidence,
        evidenceBasis,
        researchReferral,
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
