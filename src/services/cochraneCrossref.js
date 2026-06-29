const { fetchWithRetry } = require("../utils/fetchWithRetry");

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
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query.bibliographic", query);
  url.searchParams.set(
    "query.container-title",
    "Cochrane Database of Systematic Reviews"
  );
  url.searchParams.set("rows", String(Math.min(Number(limit) || 10, 20)));
  url.searchParams.set(
    "select",
    "DOI,title,author,container-title,published-print,published-online,published,date,URL,type,abstract,publisher"
  );

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

function normalizeCochraneWork(item = {}) {
  const year =
    item["published-print"]?.["date-parts"]?.[0]?.[0] ||
    item["published-online"]?.["date-parts"]?.[0]?.[0] ||
    item.published?.["date-parts"]?.[0]?.[0] ||
    null;

  const authors = (item.author || [])
    .map((author) =>
      [author.given, author.family].filter(Boolean).join(" ")
    )
    .filter(Boolean)
    .slice(0, 12)
    .join(", ");

  return {
    source_name: "Cochrane via Crossref",
    source_id: item.DOI || null,
    title: Array.isArray(item.title) ? item.title[0] : item.title,
    abstract: item.abstract || null,
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
    raw_metadata: {
      source: "Crossref targeted Cochrane metadata search",
      publisher: item.publisher || null,
      crossref_type: item.type || null,
    },
  };
}

async function searchCochraneCrossref(
  query,
  limit = 10,
  filters = {}
) {
  const url = buildCochraneSearchUrl(query, limit, filters);
  const response = await fetchWithRetry(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "OpenPhysioAI/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Cochrane Crossref error ${response.status}`);
  }

  const data = await response.json();
  const items = data?.message?.items || [];

  return items
    .map(normalizeCochraneWork)
    .filter((article) => article.title);
}

module.exports = {
  searchCochraneCrossref,
  buildCochraneSearchUrl,
  normalizeCochraneWork,
};
