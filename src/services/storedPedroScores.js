const { getSupabaseAdmin } = require("./supabase");
const { parsePedroScore } = require("./pedroScore");

const REFRESH_INTERVAL_MS = Number(
  process.env.PEDRO_SCORE_CACHE_REFRESH_MS || 15 * 60 * 1000
);

let scoreIndex = new Map();
let loadedAt = 0;
let loadPromise = null;

function normalizeDoi(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
}

function normalizeId(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeTitle(value = "") {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildArticleKeys(article = {}) {
  const keys = [];
  const doi = normalizeDoi(article.doi);
  const pmid = normalizeId(article.pmid);
  const pmcid = normalizeId(article.pmcid);
  const title = normalizeTitle(article.title);
  const year = Number(article.year) || null;

  if (doi) keys.push(`doi:${doi}`);
  if (pmid) keys.push(`pmid:${pmid}`);
  if (pmcid) keys.push(`pmcid:${pmcid}`);
  if (title && year) keys.push(`title:${title}:year:${year}`);
  if (title) keys.push(`title:${title}`);

  return keys;
}

function indexStoredPedroRows(rows = []) {
  const nextIndex = new Map();

  for (const row of rows) {
    const score = parsePedroScore(row.pedro_score);
    if (score === null) continue;

    for (const key of buildArticleKeys(row)) {
      if (!nextIndex.has(key)) {
        nextIndex.set(key, {
          score,
          matched_by: key.split(":", 1)[0],
          article_id: row.id || null,
        });
      }
    }
  }

  return nextIndex;
}

async function fetchAllStoredPedroRows() {
  const supabase = getSupabaseAdmin();
  const rows = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("research_articles")
      .select("id,doi,pmid,pmcid,title,year,pedro_score")
      .not("pedro_score", "is", null)
      .range(offset, offset + pageSize - 1);

    if (error) throw error;

    const page = data || [];
    rows.push(...page);

    if (page.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

async function refreshStoredPedroScores() {
  const rows = await fetchAllStoredPedroRows();
  scoreIndex = indexStoredPedroRows(rows);
  loadedAt = Date.now();
  return scoreIndex.size;
}

async function ensureStoredPedroScoresLoaded({ force = false } = {}) {
  const isFresh =
    loadedAt > 0 &&
    Date.now() - loadedAt < REFRESH_INTERVAL_MS;

  if (!force && isFresh) return scoreIndex.size;
  if (loadPromise) return loadPromise;

  loadPromise = refreshStoredPedroScores()
    .catch((error) => {
      console.warn(
        "Stored PEDro score refresh error:",
        error.message
      );
      return scoreIndex.size;
    })
    .finally(() => {
      loadPromise = null;
    });

  return loadPromise;
}

function findStoredPedroScore(article = {}) {
  for (const key of buildArticleKeys(article)) {
    const match = scoreIndex.get(key);
    if (match) return match;
  }

  return null;
}

function enrichArticleWithStoredPedroScore(article = {}) {
  const currentScore = parsePedroScore(article.pedro_score);

  if (currentScore !== null) {
    return {
      ...article,
      pedro_score: currentScore,
      pedro_score_source: article.pedro_score_source || "incoming",
    };
  }

  const stored = findStoredPedroScore(article);
  if (!stored) return article;

  return {
    ...article,
    pedro_score: stored.score,
    pedro_score_source: "supabase_confirmed",
    pedro_score_matched_by: stored.matched_by,
    pedro_score_article_id: stored.article_id,
  };
}

function enrichArticlesWithStoredPedroScores(articles = []) {
  return articles.map(enrichArticleWithStoredPedroScore);
}

function replaceStoredPedroIndexForTests(rows = []) {
  scoreIndex = indexStoredPedroRows(rows);
  loadedAt = Date.now();
}

module.exports = {
  normalizeDoi,
  normalizeTitle,
  buildArticleKeys,
  indexStoredPedroRows,
  ensureStoredPedroScoresLoaded,
  refreshStoredPedroScores,
  findStoredPedroScore,
  enrichArticleWithStoredPedroScore,
  enrichArticlesWithStoredPedroScores,
  replaceStoredPedroIndexForTests,
};
