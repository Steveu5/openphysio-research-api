const { fetchWithRetry } = require("../utils/fetchWithRetry");

function buildSemanticScholarSearchUrl(
  query,
  limit = 10,
  filters = {}
) {
  const url = new URL(
    "https://api.semanticscholar.org/graph/v1/paper/search"
  );

  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(Math.min(Number(limit) || 10, 100)));
  url.searchParams.set(
    "fields",
    [
      "paperId",
      "title",
      "abstract",
      "year",
      "publicationDate",
      "authors",
      "venue",
      "journal",
      "externalIds",
      "openAccessPdf",
      "publicationTypes",
      "url",
      "citationCount",
    ].join(",")
  );

  if (filters.year_from != null || filters.year_to != null) {
    const from = filters.year_from == null ? "" : String(filters.year_from);
    const to = filters.year_to == null ? "" : String(filters.year_to);
    url.searchParams.set("year", `${from}-${to}`);
  }

  return url;
}

function normalizeSemanticScholarPaper(paper = {}) {
  const externalIds = paper.externalIds || {};
  const authors = Array.isArray(paper.authors)
    ? paper.authors
        .map((author) => author?.name)
        .filter(Boolean)
        .slice(0, 12)
        .join(", ")
    : null;

  const publicationTypes = Array.isArray(paper.publicationTypes)
    ? paper.publicationTypes.filter(Boolean)
    : [];

  return {
    source_name: "Semantic Scholar",
    source_id: paper.paperId || null,
    title: paper.title || null,
    abstract: paper.abstract || null,
    doi: externalIds.DOI || null,
    pmid: externalIds.PubMed || null,
    pmcid: externalIds.PubMedCentral || null,
    journal: paper.journal?.name || paper.venue || null,
    year: paper.year || null,
    publication_date: paper.publicationDate || null,
    authors_text: authors,
    study_type: publicationTypes.join("; ") || null,
    source_url:
      paper.url ||
      (paper.paperId
        ? `https://www.semanticscholar.org/paper/${paper.paperId}`
        : null),
    open_access: Boolean(paper.openAccessPdf?.url),
    raw_metadata: {
      semantic_scholar_id: paper.paperId || null,
      citation_count: paper.citationCount ?? null,
      publication_types: publicationTypes,
      open_access_pdf_url: paper.openAccessPdf?.url || null,
    },
  };
}

async function searchSemanticScholar(
  query,
  limit = 10,
  filters = {}
) {
  const url = buildSemanticScholarSearchUrl(query, limit, filters);
  const headers = {
    Accept: "application/json",
    "User-Agent": "OpenPhysioAI/1.0",
  };

  if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
    headers["x-api-key"] = process.env.SEMANTIC_SCHOLAR_API_KEY;
  }

  const response = await fetchWithRetry(
    url.toString(),
    { headers },
    { retries: 2, timeoutMs: 12000 }
  );

  if (!response.ok) {
    throw new Error(
      `Semantic Scholar error ${response.status}`
    );
  }

  const data = await response.json();
  const papers = Array.isArray(data?.data) ? data.data : [];

  return papers
    .map(normalizeSemanticScholarPaper)
    .filter((paper) => paper.title);
}

module.exports = {
  searchSemanticScholar,
  buildSemanticScholarSearchUrl,
  normalizeSemanticScholarPaper,
};
