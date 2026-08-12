const APPLICABILITY_RANK = {
  direct: 4,
  component_framework: 3,
  related: 2,
  regional_framework: 1,
};

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function resolveApplicability(article = {}) {
  const declared =
    article.library_resource?.applicability ||
    article.guideline_applicability;

  if (APPLICABILITY_RANK[declared]) return declared;
  if (article.library_link_match?.kind === "exact_library_guide") {
    return "related";
  }
  return "regional_framework";
}

function applicabilityLabel(applicability) {
  if (applicability === "direct") return "Aplicación directa";
  if (applicability === "component_framework") {
    return "Marco clínico relacionado";
  }
  if (applicability === "related") return "Guía relacionada";
  return "Contexto clínico por región";
}

function recommendationConfidence(applicability) {
  if (applicability === "direct") return "high";
  if (
    applicability === "component_framework" ||
    applicability === "related"
  ) {
    return "moderate";
  }
  return "contextual";
}

function toLibraryRecommendation(article = {}) {
  const resource = article.library_resource;
  if (!resource || (!resource.slug && !resource.href)) return null;

  const applicability = resolveApplicability(article);
  return {
    id: resource.id || null,
    slug: resource.slug || null,
    title: resource.title || article.title || "Guía clínica",
    journal: resource.journal_name || article.journal || null,
    year: resource.publication_year || article.year || null,
    source_index:
      Number.isInteger(Number(article.source_index)) &&
      Number(article.source_index) > 0
      ? Number(article.source_index)
      : null,
    applicability,
    applicability_label: applicabilityLabel(applicability),
    recommendation_confidence: recommendationConfidence(applicability),
    scope_note:
      article.guideline_scope_note_es ||
      article.guideline_scope_note_en ||
      null,
    links: resource.links || {},
    href: resource.href || null,
    _rank: [
      APPLICABILITY_RANK[applicability] || 0,
      normalizeNumber(article.query_relevance_score),
      normalizeNumber(article.reading_priority_score),
      normalizeNumber(resource.publication_year || article.year),
    ],
  };
}

function compareRecommendations(left, right) {
  for (let index = 0; index < left._rank.length; index += 1) {
    const difference = right._rank[index] - left._rank[index];
    if (difference !== 0) return difference;
  }
  return String(left.title).localeCompare(String(right.title));
}

function selectLibraryRecommendations(articles = [], { limit = 1 } = {}) {
  const ranked = (Array.isArray(articles) ? articles : [])
    .map(toLibraryRecommendation)
    .filter(Boolean)
    .sort(compareRecommendations);
  const seen = new Set();
  const selected = [];

  for (const recommendation of ranked) {
    const key = String(
      recommendation.slug || recommendation.id || recommendation.title
    ).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(recommendation);
  }

  return selected
    .slice(0, Math.max(0, Math.min(Number(limit) || 1, 1)))
    .map(({ _rank, ...recommendation }) => recommendation);
}

module.exports = {
  APPLICABILITY_RANK,
  resolveApplicability,
  toLibraryRecommendation,
  selectLibraryRecommendations,
};
