function inferStudyType(article) {
  const title = String(article.title || "").toLowerCase();
  const abstract = String(article.abstract || "").toLowerCase();
  const sourceType = String(article.study_type || "").toLowerCase();
  const text = `${title} ${abstract} ${sourceType}`;

  if (
    title.includes("clinical practice guideline") ||
    title.includes("practice guideline") ||
    sourceType.includes("clinical practice guideline") ||
    sourceType.includes("guideline")
  ) {
    return "clinical practice guideline";
  }
  if (text.includes("systematic review") && text.includes("meta-analysis")) return "systematic review and meta-analysis";
  if (text.includes("meta-analysis") || text.includes("meta analysis")) return "meta-analysis";
  if (text.includes("systematic review")) return "systematic review";
  if (title.includes("review") || abstract.includes("aim of this review") || abstract.includes("this review")) return "review";
  if (
    title.includes("randomized controlled trial") ||
    title.includes("randomised controlled trial") ||
    title.includes("randomized trial") ||
    title.includes("randomised trial") ||
    sourceType.includes("randomized controlled trial") ||
    sourceType.includes("randomised controlled trial") ||
    sourceType.includes(" rct")
  ) return "randomized controlled trial";
  if (text.includes("cohort")) return "cohort study";
  if (text.includes("case-control") || text.includes("case control")) return "case-control study";
  if (text.includes("cross-sectional") || text.includes("cross sectional")) return "cross-sectional study";

  return article.study_type || null;
}

function normalizeDoi(doi) {
  if (!doi) return null;
  return String(doi)
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .toLowerCase();
}

function normalizeArticle(raw, intent = {}) {
  return {
    doi: normalizeDoi(raw.doi),
    pmid: raw.pmid ? String(raw.pmid) : null,
    pmcid: raw.pmcid ? String(raw.pmcid) : null,
    openalex_id: raw.openalex_id || null,

    title: raw.title ? String(raw.title).replace(/\s+/g, " ").trim() : null,
    abstract: raw.abstract ? String(raw.abstract).replace(/\s+/g, " ").trim() : null,
    conclusion: null,
    clinical_takeaway: null,

    authors_text: raw.authors_text || null,
    journal: raw.journal || null,
    year: raw.year ? Number(raw.year) : null,
    publication_date: raw.publication_date || null,

    study_type: inferStudyType(raw),
    evidence_category: null,
    source_name: raw.source_name || null,
    source_url: raw.source_url || null,
    open_access: raw.open_access ?? false,
    language: null,

    pedro_score: null,
    body_region: intent.body_region || null,
    condition: intent.condition || null,
    intervention: intent.intervention || null,
    population: intent.population || null,
    outcome: intent.outcome || null,
    specialty: "physiotherapy",

    raw_metadata: raw.raw_metadata || raw,
  };
}

module.exports = { normalizeArticle, inferStudyType, normalizeDoi };
