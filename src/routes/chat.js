const express = require("express");
const router = express.Router();

const { shouldKeepForPhysiotherapySearch } = require("../services/evidenceLevel");
const { parseResearchIntent, generateClinicalChatAnswer, generateClinicalTakeaway } = require("../services/deepseek");
const { searchEuropePmc } = require("../services/europePmc");
const { searchOpenAlex } = require("../services/openAlex");
const { searchCrossref } = require("../services/crossref");
const { searchPubMed } = require("../services/pubmed");
const { buildPreferredGuidelineQueries } = require("../services/preferredGuidelineSearch");
const { upsertArticles } = require("../services/supabase");
const { normalizeArticle } = require("../services/normalize");
const { rankArticles } = require("../services/ranking");

function normalizeTitleKey(title = "") {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function articleDedupKey(article = {}) {
  if (article.doi) return `doi:${String(article.doi).toLowerCase()}`;
  if (article.pmid) return `pmid:${String(article.pmid)}`;
  if (article.pmcid) return `pmcid:${String(article.pmcid).toLowerCase()}`;

  const titleKey = normalizeTitleKey(article.title);
  if (titleKey && article.year) return `title:${titleKey}:year:${article.year}`;
  if (titleKey) return `title:${titleKey}`;

  return null;
}

function sourcePriority(sourceName = "") {
  const source = String(sourceName).toLowerCase();
  if (source.includes("pubmed")) return 4;
  if (source.includes("europe pmc")) return 3;
  if (source.includes("openalex")) return 2;
  if (source.includes("crossref")) return 1;
  return 0;
}

function mergeArticleRecords(current = {}, incoming = {}) {
  const currentAbstractLength = String(current.abstract || "").length;
  const incomingAbstractLength = String(incoming.abstract || "").length;
  const incomingHasBetterAbstract = incomingAbstractLength > currentAbstractLength;
  const incomingHasBetterSource = sourcePriority(incoming.source_name) > sourcePriority(current.source_name);

  const base = incomingHasBetterAbstract || incomingHasBetterSource
    ? { ...current, ...incoming }
    : { ...incoming, ...current };

  return {
    ...base,
    doi: current.doi || incoming.doi || null,
    pmid: current.pmid || incoming.pmid || null,
    pmcid: current.pmcid || incoming.pmcid || null,
    openalex_id: current.openalex_id || incoming.openalex_id || null,
    abstract: incomingHasBetterAbstract ? incoming.abstract : current.abstract || incoming.abstract || null,
    open_access: Boolean(current.open_access || incoming.open_access),
    source_url:
      (current.pmid || incoming.pmid) ? `https://pubmed.ncbi.nlm.nih.gov/${current.pmid || incoming.pmid}/` :
      current.source_url || incoming.source_url || null,
  };
}

function deduplicateArticles(articles = []) {
  const byKey = new Map();

  for (const article of articles) {
    const key = articleDedupKey(article);
    if (!key) continue;

    if (!byKey.has(key)) {
      byKey.set(key, article);
      continue;
    }

    byKey.set(key, mergeArticleRecords(byKey.get(key), article));
  }

  return Array.from(byKey.values());
}

function textIncludesAny(text = "", terms = []) {
  const normalized = String(text || "").toLowerCase();
  return terms.some((term) => normalized.includes(String(term).toLowerCase()));
}

function isEditorialNoise(article = {}) {
  const title = `${article.title || ""}`.toLowerCase().trim();
  const studyType = `${article.study_type || ""}`.toLowerCase();
  const abstract = `${article.abstract || ""}`.toLowerCase().trim();

  const noisyTitleStarts = [
    "correction:",
    "correction to:",
    "erratum:",
    "erratum to:",
    "response to",
    "reply to",
    "comment on",
    "letter to",
    "editorial:",
  ];

  if (noisyTitleStarts.some((prefix) => title.startsWith(prefix))) return true;

  if (textIncludesAny(studyType, ["correction", "erratum", "letter", "comment", "editorial", "news", "published erratum"])) {
    return true;
  }

  return (
    abstract.startsWith("editorial") ||
    abstract.startsWith("editorials") ||
    abstract.includes("author, article, and disclosure information") ||
    abstract.includes("advertisement figuresreferencesrelateddetails")
  );
}

function getConditionTerms(intent = {}) {
  const terms = [String(intent.condition || "").toLowerCase()].filter(Boolean);
  const condition = terms.join(" ");

  if (condition.includes("low back") || condition.includes("lumbar")) {
    terms.push("chronic low back pain", "low back pain", "lumbar pain", "nonspecific low back pain", "non-specific low back pain");
  }

  if (condition.includes("achilles")) {
    terms.push("achilles tendinopathy", "achilles tendon", "midportion achilles");
  }

  if (condition.includes("rotator cuff") || condition.includes("shoulder")) {
    terms.push("rotator cuff", "shoulder pain", "subacromial pain");
  }

  return Array.from(new Set(terms.filter(Boolean)));
}

function articleMatchesCondition(article = {}, intent = {}) {
  const text = `${article.title || ""} ${article.abstract || ""}`.toLowerCase();
  const terms = getConditionTerms(intent);
  if (!terms.length) return true;
  return terms.some((term) => text.includes(term));
}

function isPreferredGuidelineOrPhysioSource(article = {}, intent = {}) {
  const title = `${article.title || ""}`.toLowerCase();
  const abstract = `${article.abstract || ""}`.toLowerCase();
  const journal = `${article.journal || ""}`.toLowerCase();
  const studyType = `${article.study_type || ""}`.toLowerCase();
  const source = `${article.source_name || ""}`.toLowerCase();
  const combined = `${title} ${abstract} ${journal} ${studyType} ${source}`;

  const isGuideline = textIncludesAny(combined, ["clinical practice guideline", "practice guideline", "guideline", "recommendations"]);
  const isPreferredPhysioSource = textIncludesAny(`${journal} ${source} ${title}`, [
    "journal of orthopaedic and sports physical therapy",
    "j orthop sports phys ther",
    "jospt",
    "academy of orthopaedic physical therapy",
    "american physical therapy association",
    "apta",
    "journal of physiotherapy",
    "physical therapy and rehabilitation journal",
    "nice guideline",
    "american academy of orthopaedic surgeons",
    "aaos",
  ]);

  return (isGuideline || isPreferredPhysioSource) && articleMatchesCondition(article, intent);
}

async function runSupplementalPreferredGuidelineSearch(intent, originalQuery, limit) {
  const queries = buildPreferredGuidelineQueries(intent, originalQuery);
  if (!queries.length) return [];

  const results = await Promise.allSettled(
    queries.map(async (supplementalQuery) => {
      const [pubmed, openalex] = await Promise.allSettled([
        searchPubMed(supplementalQuery, Math.min(4, limit)),
        searchOpenAlex(supplementalQuery, Math.min(4, limit)),
      ]);

      return [
        ...(pubmed.status === "fulfilled" ? pubmed.value : []),
        ...(openalex.status === "fulfilled" ? openalex.value : []),
      ];
    })
  );

  return results.flatMap((item) => item.status === "fulfilled" ? item.value : []);
}

async function buildPrioritizedEvidence(question, limit = 8) {
  const intent = await parseResearchIntent(question);
  const searchText = intent.boolean_query || intent.search_query || intent.normalized_query || question;
  const resultLimit = Math.min(Number(limit || 8), 12);

  const [europePmcResults, openAlexResults, crossrefResults, pubMedResults, preferredGuidelineResults] = await Promise.allSettled([
    searchEuropePmc(searchText, resultLimit),
    searchOpenAlex(searchText, resultLimit),
    searchCrossref(searchText, resultLimit),
    searchPubMed(searchText, resultLimit),
    runSupplementalPreferredGuidelineSearch(intent, question, resultLimit),
  ]);

  const rawResults = [
    ...(europePmcResults.status === "fulfilled" ? europePmcResults.value : []),
    ...(openAlexResults.status === "fulfilled" ? openAlexResults.value : []),
    ...(crossrefResults.status === "fulfilled" ? crossrefResults.value : []),
    ...(pubMedResults.status === "fulfilled" ? pubMedResults.value : []),
    ...(preferredGuidelineResults.status === "fulfilled" ? preferredGuidelineResults.value : []),
  ];

  const normalized = deduplicateArticles(
    rawResults
      .map((item) => normalizeArticle(item, intent))
      .filter((article) => article.title)
      .filter((article) => !isEditorialNoise(article))
  );

  const filtered = normalized.filter((article) => {
    if (intent.condition && !articleMatchesCondition(article, intent)) return false;
    return shouldKeepForPhysiotherapySearch(article, intent) || isPreferredGuidelineOrPhysioSource(article, intent);
  });

  const finalPool = filtered.length >= 3 ? filtered : normalized;
  const ranked = rankArticles(finalPool, intent).slice(0, resultLimit);
  const savedArticles = await upsertArticles(ranked);

  for (const article of savedArticles.slice(0, 2)) {
    if (!article.clinical_takeaway && article.abstract) {
      generateClinicalTakeaway(article).catch((err) => console.warn("Chat takeaway background error:", err.message));
    }
  }

  return { intent, articles: savedArticles };
}

router.post("/evidence-answer", async (req, res, next) => {
  try {
    const { question, chatInput, message, messages = [], limit = 8 } = req.body || {};
    const userQuestion = question || chatInput || message;

    if (!userQuestion || typeof userQuestion !== "string") {
      return res.status(400).json({ error: "question is required" });
    }

    const { intent, articles } = await buildPrioritizedEvidence(userQuestion, limit);
    const reply = await generateClinicalChatAnswer({
      question: userQuestion,
      intent,
      articles: articles.slice(0, 8),
      messages,
    });

    const sources = articles.slice(0, 4).map((article) => ({
      title: article.title,
      year: article.year,
      journal: article.journal,
      study_type: article.study_type,
      doi: article.doi,
      pmid: article.pmid,
      source_url: article.source_url,
      evidence_level_label_es: article.evidence_level_label_es,
    }));

    res.json({
      reply,
      sources,
      searchStrategy: intent,
      evidence_count: articles.length,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
