const {
  filterProfessionalArticles,
} = require("./trustedSources");

const {
  fetchWithRetry,
} = require("../utils/fetchWithRetry");

const DEFAULT_MIN_ABSTRACT_LENGTH = Number(
  process.env.MIN_ENRICHED_ABSTRACT_LENGTH || 280
);

function cleanText(value = "") {
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

function normalizeDoi(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
}

function normalizeTitle(value = "") {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIdentifier(value = "") {
  return String(value || "").trim().toLowerCase();
}

function buildEuropePmcQuery(query, filters = {}) {
  const clauses = [`(${query})`];

  if (filters.year_from != null || filters.year_to != null) {
    const fromYear = filters.year_from == null
      ? 1900
      : filters.year_from;

    const toYear = filters.year_to == null
      ? new Date().getUTCFullYear()
      : filters.year_to;

    clauses.push(
      `FIRST_PDATE:[${fromYear}-01-01 TO ${toYear}-12-31]`
    );
  }

  if (filters.open_access === true) {
    clauses.push("OPEN_ACCESS:Y");
  }

  return clauses.join(" AND ");
}

function getFullTextMetadata(item = {}) {
  const urls = item.fullTextUrlList?.fullTextUrl || [];
  const normalizedUrls = urls
    .map((entry) => ({
      url: entry.url || null,
      site: entry.site || null,
      availability: entry.availability || null,
      availability_code: entry.availabilityCode || null,
      document_style: entry.documentStyle || null,
    }))
    .filter((entry) => entry.url);

  const preferred =
    normalizedUrls.find((entry) =>
      /pmc|europe pmc/i.test(entry.site || "") &&
      /html/i.test(entry.document_style || "")
    ) ||
    normalizedUrls.find((entry) =>
      /pmc|europe pmc/i.test(entry.site || "")
    ) ||
    normalizedUrls[0] ||
    null;

  const pmcUrl = item.pmcid
    ? `https://pmc.ncbi.nlm.nih.gov/articles/${item.pmcid}/`
    : null;

  return {
    full_text_available: Boolean(
      item.pmcid ||
      item.inEPMC === "Y" ||
      item.isOpenAccess === "Y" ||
      preferred
    ),
    full_text_url: pmcUrl || preferred?.url || null,
    full_text_source: pmcUrl
      ? "PubMed Central"
      : preferred?.site || null,
    full_text_urls: normalizedUrls,
  };
}

function normalizeEuropePmcResult(item = {}) {
  const abstract = cleanText(item.abstractText);
  const fullText = getFullTextMetadata(item);

  return {
    source_name: "Europe PMC",
    source_id: item.id,
    title: cleanText(item.title),
    abstract: abstract || null,
    abstract_source: abstract ? "Europe PMC" : null,
    abstract_length: abstract.length,
    abstract_enriched: false,
    doi: item.doi || null,
    pmid: item.pmid || null,
    pmcid: item.pmcid || null,
    journal: item.journalTitle || null,
    year: item.pubYear
      ? Number(item.pubYear)
      : null,
    publication_date:
      item.firstPublicationDate ||
      item.firstIndexDate ||
      null,
    authors_text: item.authorString || null,
    source_url: item.pmid
      ? `https://pubmed.ncbi.nlm.nih.gov/${item.pmid}/`
      : item.doi
        ? `https://doi.org/${item.doi}`
        : fullText.full_text_url,
    open_access: item.isOpenAccess === "Y" || Boolean(item.pmcid),
    ...fullText,
    raw_metadata: item,
  };
}

async function fetchEuropePmcCore(query, pageSize = 10) {
  const url = new URL(
    "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
  );

  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("resultType", "core");
  url.searchParams.set(
    "pageSize",
    String(Math.min(Math.max(Number(pageSize) || 10, 1), 100))
  );

  const response = await fetchWithRetry(
    url.toString(),
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "OpenPhysioAI/1.0",
      },
    },
    {
      retries: 2,
      timeoutMs: 15000,
    }
  );

  if (!response.ok) {
    throw new Error(
      `Europe PMC error ${response.status}`
    );
  }

  const data = await response.json();
  return data?.resultList?.result || [];
}

async function searchEuropePmc(
  query,
  limit = 10,
  filters = {}
) {
  const results = await fetchEuropePmcCore(
    buildEuropePmcQuery(query, filters),
    Math.min((Number(limit) || 10) * 4, 100)
  );

  const normalized = results.map(normalizeEuropePmcResult);

  return filterProfessionalArticles(normalized)
    .slice(0, Number(limit) || 10);
}

function escapeEuropePmcValue(value = "") {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .trim();
}

function buildIdentifierClauses(article = {}) {
  const clauses = [];

  if (article.pmid) {
    clauses.push(`EXT_ID:${escapeEuropePmcValue(article.pmid)}`);
  }

  if (article.pmcid) {
    clauses.push(`PMCID:${escapeEuropePmcValue(article.pmcid)}`);
  }

  if (article.doi) {
    clauses.push(`DOI:"${escapeEuropePmcValue(normalizeDoi(article.doi))}"`);
  }

  return clauses;
}

function needsMetadataEnrichment(
  article = {},
  minAbstractLength = DEFAULT_MIN_ABSTRACT_LENGTH
) {
  const abstractLength = cleanText(article.abstract).length;

  return Boolean(
    buildIdentifierClauses(article).length &&
    (
      abstractLength < minAbstractLength ||
      !article.pmcid ||
      article.open_access == null
    )
  );
}

function buildMatchIndex(results = []) {
  const index = new Map();

  for (const rawItem of results) {
    const item = normalizeEuropePmcResult(rawItem);
    const keys = [
      item.pmid ? `pmid:${normalizeIdentifier(item.pmid)}` : null,
      item.pmcid ? `pmcid:${normalizeIdentifier(item.pmcid)}` : null,
      item.doi ? `doi:${normalizeDoi(item.doi)}` : null,
      item.title ? `title:${normalizeTitle(item.title)}` : null,
    ].filter(Boolean);

    for (const key of keys) {
      if (!index.has(key)) index.set(key, item);
    }
  }

  return index;
}

function findEuropePmcMatch(article = {}, index = new Map()) {
  const keys = [
    article.pmid ? `pmid:${normalizeIdentifier(article.pmid)}` : null,
    article.pmcid ? `pmcid:${normalizeIdentifier(article.pmcid)}` : null,
    article.doi ? `doi:${normalizeDoi(article.doi)}` : null,
    article.title ? `title:${normalizeTitle(article.title)}` : null,
  ].filter(Boolean);

  for (const key of keys) {
    const match = index.get(key);
    if (match) return match;
  }

  return null;
}

function mergeEuropePmcMetadata(article = {}, match = {}) {
  const currentAbstract = cleanText(article.abstract);
  const candidateAbstract = cleanText(match.abstract);
  const useCandidateAbstract =
    candidateAbstract.length > currentAbstract.length;

  const abstract = useCandidateAbstract
    ? candidateAbstract
    : currentAbstract || null;

  return {
    ...article,
    abstract,
    abstract_source: useCandidateAbstract
      ? "Europe PMC"
      : article.abstract_source || (abstract ? article.source_name : null),
    abstract_length: abstract ? abstract.length : 0,
    abstract_enriched: Boolean(
      article.abstract_enriched || useCandidateAbstract
    ),
    doi: article.doi || match.doi || null,
    pmid: article.pmid || match.pmid || null,
    pmcid: article.pmcid || match.pmcid || null,
    open_access: Boolean(
      article.open_access ||
      match.open_access ||
      match.pmcid
    ),
    full_text_available: Boolean(
      article.full_text_available ||
      match.full_text_available
    ),
    full_text_url:
      article.full_text_url ||
      match.full_text_url ||
      null,
    full_text_source:
      article.full_text_source ||
      match.full_text_source ||
      null,
    raw_metadata: {
      ...(article.raw_metadata || {}),
      europe_pmc_enrichment: {
        matched: true,
        abstract_replaced: useCandidateAbstract,
        abstract_length_before: currentAbstract.length,
        abstract_length_after: abstract?.length || 0,
        pmid: match.pmid || null,
        pmcid: match.pmcid || null,
        doi: match.doi || null,
        open_access: match.open_access,
        full_text_available: match.full_text_available,
        full_text_url: match.full_text_url,
      },
    },
  };
}

function chunk(items = [], size = 10) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function enrichArticlesWithEuropePmcMetadata(
  articles = [],
  options = {}
) {
  if (process.env.ENABLE_EUROPE_PMC_ENRICHMENT === "false") {
    return articles;
  }

  const minAbstractLength = Number(
    options.minAbstractLength || DEFAULT_MIN_ABSTRACT_LENGTH
  );
  const maxArticles = Math.min(
    Math.max(Number(options.maxArticles || 20), 1),
    40
  );

  const candidates = articles
    .filter((article) =>
      needsMetadataEnrichment(article, minAbstractLength)
    )
    .slice(0, maxArticles);

  if (!candidates.length) return articles;

  const resultSets = await Promise.allSettled(
    chunk(candidates, 8).map(async (articleChunk) => {
      const clauses = Array.from(new Set(
        articleChunk.flatMap(buildIdentifierClauses)
      ));

      if (!clauses.length) return [];

      return fetchEuropePmcCore(
        `(${clauses.join(" OR ")})`,
        Math.min(clauses.length * 2, 100)
      );
    })
  );

  const fetchedResults = resultSets.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  );

  if (!fetchedResults.length) return articles;

  const matchIndex = buildMatchIndex(fetchedResults);

  return articles.map((article) => {
    const match = findEuropePmcMatch(article, matchIndex);
    return match
      ? mergeEuropePmcMetadata(article, match)
      : article;
  });
}

module.exports = {
  searchEuropePmc,
  buildEuropePmcQuery,
  normalizeEuropePmcResult,
  buildIdentifierClauses,
  needsMetadataEnrichment,
  findEuropePmcMatch,
  mergeEuropePmcMetadata,
  enrichArticlesWithEuropePmcMetadata,
};
