const express = require("express");
const { meterAiOperation, annotateAiOperation } = require("../services/aiUsage");

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
  selectEvidenceForResponse,
} = require("../services/evidenceSelectionGuard");
const {
  refineResearchResultsFinal,
} = require("../services/researchFinalRefinement");
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
  rankByClinicalMatch,
  summarizeClinicalMatch,
} = require("../services/clinicalMatch");
const { buildGapFollowUps } = require("../services/chatFollowUps");
const { MAX_COMPARISON_SOURCES } = require("../services/chatSourceSelection");
const { assessChatEvidence } = require("../services/chatEvidenceAssessment");
const {
  screenRedFlags,
  mergeModelSafetyConcern,
  applySafetyToStructure,
} = require("../services/clinicalSafety");
const {
  buildInsufficientEvidenceStructure,
} = require("../services/evidenceSufficiency");
const {
  buildConversationalChatResponse,
} = require("../services/chatConversationalIntent");
const {
  resolveIdempotencyKey,
  getUsageSummary,
  reserveUsage,
  releaseUsage,
  settleUsage,
} = require("../services/usageQuota");
const { degradedNotice } = require("../services/degradedResponse");
const {
  buildRetrievalDegradedChatStructure,
  publicRetrieval,
} = require("../services/retrievalDegraded");
const { assertNotCoolingDown } = require("../services/degradedCooldown");
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
const {
  validateChatRequest,
} = require("../services/requestValidation");

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
  return articles.slice(0, MAX_COMPARISON_SOURCES).map((article, index) => ({
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
    clinical_match: article.clinical_match || null,
  }));
}

function buildResearchReferralQuery(question = "", intent = {}) {
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

// Backward-compatible quota shape ({used, limit, remaining, monthKey}) for
// clients that predate the combined `usage` object.
function legacyQuota(usage) {
  if (!usage?.chat) return undefined;
  return { ...usage.chat, monthKey: usage.period?.key };
}

router.post(
  "/evidence-answer",
  requireAuthenticatedUser,
  chatUserRateLimit,
  requireActiveSubscription,
  meterAiOperation("chat_question"),
  async (req, res, next) => {
    let reservation = null;

    try {
      const {
        question: userQuestion,
        messages,
        limit,
        filters,
        sessionId,
      } = validateChatRequest(req.body || {});

      const subscription = {
        userId: req.user.id,
        subscriptionStatus: req.subscription?.status,
        currentPeriodEnd: req.subscription?.currentPeriodEnd,
      };

      // Greetings and capability questions are answered without retrieval
      // or AI, so they do not consume a Chat unit.
      const conversationalResponse = buildConversationalChatResponse(
        userQuestion
      );
      if (conversationalResponse) {
        annotateAiOperation({ conversational: true });
        const usage = await getUsageSummary(subscription).catch(() => null);
        return res.json({
          ...conversationalResponse,
          researchSystem: getResearchSystemMetadata(),
          quota: usage ? legacyQuota(usage) : undefined,
          usage,
        });
      }

      // Repeated degraded answers pause this tool briefly (never charged).
      assertNotCoolingDown(req.user.id, "chat");
      const quotaReservation = await reserveUsage({
        ...subscription,
        tool: "chat",
        idempotencyKey: resolveIdempotencyKey(req),
      });
      reservation = quotaReservation.reservation;
      annotateAiOperation({ reservationId: reservation.id });

      // Red-flag screen on the clinician's own messages, before retrieval.
      const safetyScreen = screenRedFlags({ question: userQuestion, messages });
      const evidenceQuery = buildContextualEvidenceQuery({
        question: userQuestion,
        messages,
      });

      const evidence = await searchEvidence({
        userId: req.user.id,
        query: evidenceQuery,
        displayQuery: userQuestion,
        origin: "chat",
        sessionId,
        filters,
        limit,
      });
      annotateAiOperation({ cached: Boolean(evidence.cached) });
      const language = detectResponseLanguage(userQuestion, evidence.intent);
      const libraryResult = await getLibraryGuideRecommendations({
        query: userQuestion,
        intent: evidence.intent,
        language,
        limit: 3,
        userEmail: req.user.email,
      });
      const libraryGuides = libraryResult.guides;
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
          limit: 10,
        }
      );
      // Chat policy: direct applicability first, then match, design, recency.
      const clinicallyRankedArticles = rankByClinicalMatch(
        qualitySelection.articles,
        evidence.intent,
        { mode: "chat" }
      );
      const rankedForChat = prioritizeLibraryGuides(clinicallyRankedArticles);
      // P1.3: the final sources are selected by applicability (2 to 5, up
      // to 6 for comparisons) in P0 order, and sufficiency, comparison
      // support and confidence are computed on exactly those cited sources.
      const chatEvidence = assessChatEvidence(
        rankedForChat,
        evidence.intent,
        language
      );
      const sourceSelection = chatEvidence.selection;
      const citedArticles = chatEvidence.citedArticles;
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
      const evidenceSufficiency = chatEvidence.sufficiency;
      const comparison = chatEvidence.comparison;
      let finalStructured;
      let safety = safetyScreen;
      let lastAnswer = null;
      let answerDegraded = false;
      // P2.1: nothing usable retrieved while an important provider failed
      // or timed out means the search was incomplete, not that evidence is
      // missing: a technical degraded answer (0 units), never "no evidence".
      const retrieval = evidence.retrieval || null;
      const retrievalDegraded =
        evidenceSufficiency.status === "insufficient" &&
        Boolean(retrieval?.important_failure);
      if (retrievalDegraded) {
        finalStructured = buildRetrievalDegradedChatStructure(language);
        answerDegraded = true;
      } else if (evidenceSufficiency.status === "insufficient") {
        // No model call: an explicit, deterministic answer instead of a
        // complete-looking synthesis built from tangential sources.
        finalStructured = {
          ...buildInsufficientEvidenceStructure(citedArticles, language),
          follow_up_options: [],
        };
      } else {
        lastAnswer = await generateStructuredClinicalChatAnswer({
          question: userQuestion,
          intent: evidence.intent,
          articles: citedArticles,
          messages,
          confidence: chatEvidence.confidence({ consistencyPending: true }),
          comparison,
          safety: safetyScreen,
        });
        answerDegraded = Boolean(lastAnswer.degraded);
        if (answerDegraded) {
          finalStructured = {
            ...lastAnswer.structured,
            confidence: chatEvidence.confidence(),
          };
        }
      }
      if (answerDegraded) {
        // The model gave no valid answer: return the plain fallback (sources
        // to review), without templates or refinements built on top of it.
        finalStructured = {
          ...(finalStructured || {}),
          follow_up_options: [],
        };
      } else if (evidenceSufficiency.status !== "insufficient") {
        const answer = lastAnswer;
        const safeStructured = sanitizeStructuredChatResponse(answer.structured, {
          language,
          confidence: answer.confidence,
        });
        const refinedStructured = refineStructuredClinicalChatFinal(
          safeStructured,
          citedArticles,
          language
        );
        // Confidence is decided here, once, from the sources' match trace;
        // earlier refinement passes cannot raise it.
        finalStructured = {
          ...refinedStructured,
          brief_answer: comparison.statement
            ? [
                { text: comparison.statement, source_indices: [] },
                ...(refinedStructured.brief_answer || []),
              ]
            : refinedStructured.brief_answer,
          confidence: chatEvidence.confidence({
            consistency: answer.structured?.evidence_consistency,
          }),
        };
        safety = mergeModelSafetyConcern(
          safetyScreen,
          answer.structured?.safety_concern
        );
      }
      finalStructured = applySafetyToStructure(finalStructured, safety, language);
      // P1.5: follow-ups come from what the answer left open; the first one
      // also closes the reply ("Para continuar"). None for a degraded answer.
      if (!answerDegraded) {
        const followUps = buildGapFollowUps({
          question: userQuestion,
          intent: evidence.intent,
          comparison,
          confidence: finalStructured.confidence,
          sufficiency: evidenceSufficiency,
          safety: finalStructured.safety || safety,
          structured: finalStructured,
          language,
        });
        finalStructured = {
          ...finalStructured,
          follow_up_options: followUps,
          follow_up_question: followUps[0]?.prompt || null,
        };
      }
      const evidenceBasis = getEvidenceBasisIncludingLibrary(
        citedArticles,
        language
      );
      const libraryRecommendations = getLibraryRecommendations(
        citedArticlesWithLibraryLinks
      );
      const renderedReply = renderConciseChatReply(
        finalStructured,
        language,
        { questionType: evidence.intent?.question_type }
      );
      // The evidence-synthesis banner would sit above the safety statement
      // or describe evidence that cannot answer the question.
      const safeReply =
        finalStructured.insufficient_evidence ||
        answerDegraded ||
        finalStructured.safety?.status === "red_flag"
        ? renderedReply
        : injectChatEvidenceSynthesisIntoReply(
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

      // success consumes the unit; a degraded answer releases it (within
      // the per-period allowance); errors release it in the catch below.
      const settlement = await settleUsage(
        reservation,
        answerDegraded ? "degraded" : "success",
        { cooldown: !retrievalDegraded }
      );
      reservation = null;
      const deliveredReply =
        answerDegraded && !retrievalDegraded
          ? `${degradedNotice(language, settlement.charged)}\n\n${safeReply}`
          : safeReply;
      const usageAfter = await getUsageSummary(subscription).catch(() => ({
        plan: quotaReservation.usage.plan,
        period: quotaReservation.usage.period,
        chat: {
          used: quotaReservation.usage.used,
          limit: quotaReservation.usage.limit,
          remaining: quotaReservation.usage.remaining,
        },
        research: null,
      }));

      return res.json({
        reply: deliveredReply,
        outcome: settlement.outcome,
        charged: settlement.charged,
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
        evidenceSufficiency,
        comparison,
        safety: finalStructured.safety || safety,
        clinicalMatch: summarizeClinicalMatch(citedArticles),
        sourceSelection: sourceSelection.diagnostics,
        // Which cited sources support each claim about the evidence.
        evidenceAudit: chatEvidence.audit,
        // Technical retrieval outcome per provider (frontend may ignore it).
        retrieval: publicRetrieval(retrieval),
        evidence_count: citedArticles.length,
        retrieved_evidence_count: evidence.articles.length,
        evidenceSelection: selection.diagnostics,
        evidenceSelectionVersion: selection.diagnostics.version,
        resultQuality: qualitySelection.diagnostics,
        resultQualityVersion: qualitySelection.diagnostics.version,
        chatFinalRefinementVersion: "1.4.0",
        sourcePriorityVersion: "1.1.0",
        cachedEvidence: evidence.cached,
        researchSystem: getResearchSystemMetadata(),
        quota: legacyQuota(usageAfter),
        usage: usageAfter,
      });
    } catch (error) {
      if (reservation) await releaseUsage(reservation);
      return next(error);
    }
  }
);

module.exports = router;
