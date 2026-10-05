const { fetchWithBudget } = require("../utils/fetchWithRetry");
const { recordSourceDiagnostic } = require("./sourceDiagnosticsContext");

function buildDateFilter(filters = {}) {
  const clauses = [];

  if (filters.year_from != null) {
    clauses.push(`from-pub-date:${filters.year_from}-01-01`);
  }

  if (filters.year_to != null) {
    clauses.push(`until-pub-date:${filters.year_to}-12-31`);
  }

  return clauses.join(",");
}

function buildCochraneSearchUrl(
  query,
  limit = 10,
  filters = {}
) {
  const url = new URL("https://api.crossref.org/v1/works");
  url.searchParams.set("query.bibliographic", query);
  url.searchParams.set(
    "query.container-title",
    "Cochrane Database of Systematic Reviews"
  );
  url.searchParams.set("rows", String(Math.min(Number(limit) || 10, 20)));

  const sourceFilter = buildDateFilter(filters);
  if (sourceFilter) {
    url.searchParams.set("filter", sourceFilter);
  }

  const email = process.env.CROSSREF_EMAIL || process.env.NCBI_EMAIL;
  if (email) {
    url.searchParams.set("mailto", email);
  }

  return url;
}

function cleanCrossrefAbstract(value = "") {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// `query.container-title` only ranks results, so Crossref also returns other
// journals (for example BMC "Systematic Reviews", which mostly publishes
// protocols). This adapter labels everything as a Cochrane systematic review,
// so it keeps only records actually published in the Cochrane Database.
function isCochraneDatabaseWork(item = {}) {
  const containers = Array.isArray(item["container-title"])
    ? item["container-title"]
    : [item["container-title"]];
  return containers.some((name) =>
    /cochrane database of systematic reviews/i.test(String(name || ""))
  );
}

function normalizeCochraneWork(item = {}) {
  const year =
    item["published-print"]?.["date-parts"]?.[0]?.[0] ||
    item["published-online"]?.["date-parts"]?.[0]?.[0] ||
    item.published?.["date-parts"]?.[0]?.[0] ||
    item.issued?.["date-parts"]?.[0]?.[0] ||
    null;

  const authors = (item.author || [])
    .map((author) =>
      [author.given, author.family].filter(Boolean).join(" ")
    )
    .filter(Boolean)
    .slice(0, 12)
    .join(", ");

  const abstract = cleanCrossrefAbstract(item.abstract);

  return {
    source_name: "Cochrane metadata via Crossref",
    source_id: item.DOI || null,
    title: Array.isArray(item.title) ? item.title[0] : item.title,
    abstract: abstract || null,
    abstract_source: abstract ? "Crossref" : null,
    abstract_length: abstract.length,
    abstract_enriched: false,
    doi: item.DOI || null,
    pmid: null,
    pmcid: null,
    journal: Array.isArray(item["container-title"])
      ? item["container-title"][0]
      : "Cochrane Database of Systematic Reviews",
    year,
    publication_date: null,
    authors_text: authors || null,
    study_type: "systematic review",
    source_url:
      item.URL ||
      (item.DOI ? `https://doi.org/${item.DOI}` : null),
    open_access: null,
    full_text_available: false,
    full_text_url: null,
    full_text_source: null,
    raw_metadata: {
      source: "Crossref targeted Cochrane metadata search",
      publisher: item.publisher || null,
      crossref_type: item.type || null,
      abstract_was_cleaned: Boolean(item.abstract),
    },
  };
}

async function searchCochraneCrossref(
  query,
  limit = 10,
  filters = {}
) {
  const url = buildCochraneSearchUrl(query, limit, filters);
  const email = process.env.CROSSREF_EMAIL || process.env.NCBI_EMAIL;
  const userAgent = email
    ? `OpenPhysioAI/1.1 (mailto:${email})`
    : "OpenPhysioAI/1.1";

  // Bounded by the per-operation Crossref budget: one attempt, one retry only
  // for a fast 429/5xx that still fits, never a repeated timeout.
  const startedAt = Date.now();
  let data;
  try {
    ({ data } = await fetchWithBudget(
      url.toString(),
      {
        headers: {
          Accept: "application/json",
          "User-Agent": userAgent,
        },
      },
      { provider: "crossref", retries: 1, timeoutMs: 8000, retryDelayMs: 650, parse: "json" }
    ));
  } catch (error) {
    recordSourceDiagnostic("crossref", {
      label: "Crossref",
      status: error?.timedOut ? "timeout" : "error",
      retrieved_count: 0,
      duration_ms: Date.now() - startedAt,
      timed_out: Boolean(error?.timedOut),
      budget_ms: error?.budgetMs ?? null,
      error: error?.code || error?.message || "error",
    });
    throw error;
  }

  const items = data?.message?.items || [];
  const articles = items
    .filter(isCochraneDatabaseWork)
    .map(normalizeCochraneWork)
    .filter((article) => article.title);
  recordSourceDiagnostic("crossref", {
    label: "Crossref",
    status: articles.length ? "ok" : "empty",
    retrieved_count: articles.length,
    duration_ms: Date.now() - startedAt,
    error: null,
  });
  return articles;
}

module.exports = {
  searchCochraneCrossref,
  buildCochraneSearchUrl,
  normalizeCochraneWork,
  cleanCrossrefAbstract,
  isCochraneDatabaseWork,
};
