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

async function searchEuropePmc(
  query,
  limit = 10,
  filters = {}
) {
  const url = new URL(
    "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
  );

  const filteredQuery = buildEuropePmcQuery(query, filters);

  url.searchParams.set("query", filteredQuery);
  url.searchParams.set("format", "json");
  url.searchParams.set("resultType", "core");
  url.searchParams.set("pageSize", String(limit));

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Europe PMC error ${response.status}`);
  }

  const data = await response.json();
  const results = data?.resultList?.result || [];

  return results.map((item) => ({
    source_name: "Europe PMC",
    source_id: item.id,
    title: item.title,
    abstract: item.abstractText,
    doi: item.doi,
    pmid: item.pmid,
    pmcid: item.pmcid,
    journal: item.journalTitle,
    year: item.pubYear ? Number(item.pubYear) : null,
    publication_date: item.firstPublicationDate || item.firstIndexDate || null,
    authors_text: item.authorString,
    source_url: item.pmid
      ? `https://pubmed.ncbi.nlm.nih.gov/${item.pmid}/`
      : item.doi
        ? `https://doi.org/${item.doi}`
        : null,
    open_access: item.isOpenAccess === "Y",
    raw_metadata: item,
  }));
}

module.exports = {
  searchEuropePmc,
  buildEuropePmcQuery,
};
