function openAlexAbstractToText(abstractInvertedIndex) {
  if (!abstractInvertedIndex || typeof abstractInvertedIndex !== "object") return null;

  const positions = [];
  for (const [word, indexes] of Object.entries(abstractInvertedIndex)) {
    for (const index of indexes) {
      positions[index] = word;
    }
  }
  return positions.filter(Boolean).join(" ");
}

async function searchOpenAlex(query, limit = 10) {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", String(limit));

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`OpenAlex error ${response.status}`);
  }

  const data = await response.json();
  const results = data?.results || [];

  return results.map((item) => ({
    source_name: "OpenAlex",
    source_id: item.id,
    openalex_id: item.id,
    title: item.title || item.display_name,
    abstract: openAlexAbstractToText(item.abstract_inverted_index),
    doi: item.doi ? item.doi.replace("https://doi.org/", "") : null,
    pmid: item.ids?.pmid ? item.ids.pmid.split("/").pop() : null,
    journal: item.primary_location?.source?.display_name || null,
    year: item.publication_year || null,
    publication_date: item.publication_date || null,
    authors_text: (item.authorships || [])
      .map((a) => a.author?.display_name)
      .filter(Boolean)
      .join(", "),
    source_url: item.primary_location?.landing_page_url || item.doi || item.id,
    open_access: Boolean(item.open_access?.is_oa),
    raw_metadata: item,
  }));
}

module.exports = { searchOpenAlex };
