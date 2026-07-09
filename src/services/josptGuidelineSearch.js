const { searchPubMed } = require("./pubmed");
const {
  getGuidelineConditionTerms,
} = require("./preferredGuidelineSearch");
const {
  isJospt,
  isGuideline,
} = require("./sourcePriority");

function buildJosptGuidelineQueries(intent = {}, originalQuery = "") {
  const conditionTerms = getGuidelineConditionTerms(intent);
  const fallback = String(
    intent.condition || intent.normalized_query || originalQuery || ""
  ).trim();
  const bases = conditionTerms.length ? conditionTerms : fallback ? [fallback] : [];

  return Array.from(
    new Set(
      bases.slice(0, 4).map(
        (term) =>
          `("${term}"[Title/Abstract] OR "${term}"[MeSH Terms]) AND ` +
          `("J Orthop Sports Phys Ther"[Journal]) AND ` +
          `("Practice Guideline"[Publication Type] OR "Guideline"[Publication Type] OR ` +
          `"clinical practice guideline"[Title] OR "revision"[Title])`
      )
    )
  );
}

async function searchJosptGuidelines(
  intent = {},
  originalQuery = "",
  limit = 8,
  filters = {}
) {
  const queries = buildJosptGuidelineQueries(intent, originalQuery);
  if (!queries.length) return [];

  const results = await Promise.allSettled(
    queries.map((query) =>
      searchPubMed(query, Math.min(Number(limit) || 8, 10), {
        ...filters,
        study_types: [],
      })
    )
  );

  const articles = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  );

  const unique = new Map();

  for (const article of articles) {
    if (!isJospt(article) || !isGuideline(article)) continue;

    const key = article.doi
      ? `doi:${String(article.doi).toLowerCase()}`
      : article.pmid
        ? `pmid:${article.pmid}`
        : `title:${String(article.title || "").toLowerCase()}`;

    const tagged = {
      ...article,
      retrieval_source_name: article.retrieval_source_name || "PubMed",
      targeted_search_strategy: "jospt_guideline_pubmed",
      preferred_source_key: "jospt_guideline",
      preferred_source_tier: 100,
      preferred_source_label_es: "Guía clínica JOSPT/AOPT",
      preferred_source_label_en: "JOSPT/AOPT clinical practice guideline",
    };

    const current = unique.get(key);
    if (
      !current ||
      String(tagged.abstract || "").length > String(current.abstract || "").length
    ) {
      unique.set(key, tagged);
    }
  }

  return Array.from(unique.values()).slice(0, Math.max(1, Number(limit) || 8));
}

module.exports = {
  buildJosptGuidelineQueries,
  searchJosptGuidelines,
};
