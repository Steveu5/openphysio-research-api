async function searchCrossref(query, limit = 10) {
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query", query);
  url.searchParams.set("rows", String(limit));
  url.searchParams.set("select", "DOI,title,author,container-title,published-print,published-online,published,date,URL,type,abstract");

  const response = await fetch(url.toString());
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

module.exports = { searchCrossref };
