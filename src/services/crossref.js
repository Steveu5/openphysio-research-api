const { searchCochraneCrossref } = require("./cochraneCrossref");
const { fetchWithRetry } = require("../utils/fetchWithRetry");

function buildCrossrefFilter(filters = {}) {
  const clauses = [];

  if (filters.year_from != null) {
    clauses.push(
      `from-pub-date:${filters.year_from}-01-01`
    );
  }

  if (filters.year_to != null) {
    clauses.push(
      `until-pub-date:${filters.year_to}-12-31`
    );
  }

  return clauses.join(",");
}

async function searchCrossrefOnly(
  query,
  limit = 10,
  filters = {}
) {
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query", query);
  url.searchParams.set("rows", String(limit));
  url.searchParams.set(
    "select",
    "DOI,title,author,container-title,published-print,published-online,published,date,URL,type,abstract"
  );

  const sourceFilter = buildCrossrefFilter(filters);

  if (sourceFilter) {
    url.searchParams.set("filter", sourceFilter);
  }

  const email =
    process.env.CROSSREF_EMAIL ||
    process.env.NCBI_EMAIL;

  if (email) {
    url.searchParams.set("mailto", email);
  }

  const response = await fetchWithRetry(
    url.toString(),
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "OpenPhysioAI/1.0",
      },
    },
    { retries: 2, timeoutMs: 12000 }
  );

  if (!response.ok) {
    throw new Error(`Crossref error ${response.status}`);
  }

  const data = await response.json();
  const results = data?.message?.items || [];

  return results.map((item) => {
    const year =
      item["published-print"]?.["date-parts"]?.[0]?.[0] ||
      item["published-online"]?.["date-parts"]?.[0]?.[0] ||
      item.published?.["date-parts"]?.[0]?.[0] ||
      null;

    const authors = (item.author || [])
      .map((a) => [a.given, a.family].filter(Boolean).join(" "))
      .filter(Boolean)
      .join(", ");

    return {
      source_name: "Crossref",
      source_id: item.DOI,
      title: Array.isArray(item.title) ? item.title[0] : item.title,
      abstract: item.abstract || null,
      doi: item.DOI || null,
      journal: Array.isArray(item["container-title"]) ? item["container-title"][0] : null,
      year,
      publication_date: null,
      authors_text: authors,
      study_type: item.type || null,
      source_url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : null),
      open_access: null,
      raw_metadata: item,
    };
  });
}

async function searchCrossref(
  query,
  limit = 10,
  filters = {}
) {
  const [crossrefResult, cochraneResult] = await Promise.allSettled([
    searchCrossrefOnly(query, limit, filters),
    searchCochraneCrossref(query, Math.min(limit, 10), filters),
  ]);

  const articles = [
    ...(crossrefResult.status === "fulfilled" ? crossrefResult.value : []),
    ...(cochraneResult.status === "fulfilled" ? cochraneResult.value : []),
  ];

  if (
    crossrefResult.status === "rejected" &&
    cochraneResult.status === "rejected"
  ) {
    throw new Error(
      `Crossref and Cochrane search failed: ${crossrefResult.reason?.message || "unknown"}; ${cochraneResult.reason?.message || "unknown"}`
    );
  }

  return articles;
}

module.exports = {
  searchCrossref,
  searchCrossrefOnly,
  buildCrossrefFilter,
};
