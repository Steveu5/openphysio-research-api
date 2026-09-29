// Chat evidence assessment on the sources shown to the user.
//
// The P0 ranking is untouched; selectChatSources picks the final sources in
// P0 order. Every final claim about the evidence (sufficiency, comparison
// support, confidence and directness) is computed on exactly those cited
// sources, never on a source the user cannot see, and the response carries
// an audit that maps each claim to its source indices.

const { selectChatSources } = require("./chatSourceSelection");
const { assessEvidenceSufficiency, isUsableEvidence } = require("./evidenceSufficiency");
const { assessComparison } = require("./comparisonEvidence");
const { assessEvidenceConfidence } = require("./evidenceConfidence");

// evidenceConfidence reads at most the first 4 Chat sources (P0 rule).
const CONFIDENCE_WINDOW = 4;

function indicesWhere(articles, predicate) {
  return articles
    .map((article, index) => (predicate(article) ? index + 1 : null))
    .filter(Boolean);
}

function assessChatEvidence(rankedArticles = [], intent = {}, language = "es") {
  const selection = selectChatSources(rankedArticles, intent);
  const citedArticles = selection.articles;
  const sufficiency = assessEvidenceSufficiency(citedArticles);
  const comparison = assessComparison(citedArticles, intent, language);
  const confidenceOptions = { intent, language, mode: "chat", comparison };
  const confidence = (extra = {}) =>
    assessEvidenceConfidence(citedArticles, { ...confidenceOptions, ...extra });

  const tier = (wanted) => (article) => article.clinical_match?.tier === wanted;
  const audit = {
    version: "1.0.0",
    cited_source_indices: citedArticles.map((_, index) => index + 1),
    sufficiency_basis: indicesWhere(citedArticles, isUsableEvidence),
    direct_source_indices: indicesWhere(citedArticles, tier("direct")),
    partial_source_indices: indicesWhere(citedArticles, tier("partial")),
    tangential_source_indices: indicesWhere(citedArticles, tier("tangential")),
    comparison_basis: indicesWhere(citedArticles, (article) => article.clinical_match?.direct_comparison),
    confidence_basis: citedArticles.slice(0, CONFIDENCE_WINDOW).map((_, index) => index + 1),
  };

  return { selection, citedArticles, sufficiency, comparison, confidence, confidenceOptions, audit };
}

module.exports = {
  CONFIDENCE_WINDOW,
  assessChatEvidence,
};
