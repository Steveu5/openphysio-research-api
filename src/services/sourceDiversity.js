const { isGuideline, wasRetrievedFromPubMed } = require("./sourcePriority");

function isCochraneArticle(article = {}) {
  return /cochrane/i.test(
    [article.journal, article.source_name, article.retrieval_source_name]
      .filter(Boolean)
      .join(" ")
  );
}

function isNonCochranePubMedArticle(article = {}) {
  return wasRetrievedFromPubMed(article) && !isCochraneArticle(article);
}

function articleKey(article = {}) {
  return String(
    article.id || article.doi || article.pmid || article.pmcid || article.title || ""
  )
    .toLowerCase()
    .trim();
}

function isProtectedArticle(article = {}) {
  return Boolean(article.library_resource) || isGuideline(article);
}

function ensurePubMedRepresentation(
  rankedArticles = [],
  candidateArticles = rankedArticles,
  { displayLimit = 20, minimum = 5 } = {}
) {
  const limit = Math.max(1, Number(displayLimit) || 20);
  const desiredMinimum = Math.max(0, Number(minimum) || 0);
  const displayed = rankedArticles.slice(0, limit);
  const displayedKeys = new Set(displayed.map(articleKey));
  const availablePubMed = candidateArticles.filter(
    (article) =>
      isNonCochranePubMedArticle(article) && !displayedKeys.has(articleKey(article))
  );

  const initialCount = displayed.filter(isNonCochranePubMedArticle).length;
  const totalAvailableCount = initialCount + availablePubMed.length;
  const target = Math.min(
    desiredMinimum,
    totalAvailableCount
  );

  while (
    displayed.filter(isNonCochranePubMedArticle).length < target &&
    availablePubMed.length > 0
  ) {
    let replacementIndex = -1;
    for (let index = displayed.length - 1; index >= 0; index -= 1) {
      const current = displayed[index];
      if (!isProtectedArticle(current) && !isNonCochranePubMedArticle(current)) {
        replacementIndex = index;
        break;
      }
    }
    if (replacementIndex === -1) break;
    displayed.splice(replacementIndex, 1, availablePubMed.shift());
  }

  return {
    articles: displayed,
    diagnostics: {
      version: "1.0.0",
      requested_minimum: desiredMinimum,
      available_count: totalAvailableCount,
      initial_count: initialCount,
      displayed_count: displayed.filter(isNonCochranePubMedArticle).length,
      protected_guides_and_guidelines: displayed.filter(isProtectedArticle).length,
    },
  };
}

module.exports = {
  isNonCochranePubMedArticle,
  ensurePubMedRepresentation,
};
