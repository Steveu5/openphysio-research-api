async function searchEuropePmc(query, limit = 10) {
  const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");
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

module.exports = { searchEuropePmc };
