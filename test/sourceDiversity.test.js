const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ensurePubMedRepresentation,
  isNonCochranePubMedArticle,
} = require("../src/services/sourceDiversity");

function article(index, overrides = {}) {
  return {
    id: `article-${index}`,
    title: `Article ${index}`,
    journal: "Generic Journal",
    study_type: "systematic review",
    evidence_level: "systematic_review",
    ...overrides,
  };
}

test("reserves PubMed coverage without removing Library guides or guidelines", () => {
  const guide = article("guide", {
    library_resource: { slug: "low-back-pain" },
    study_type: "clinical practice guideline",
  });
  const guideline = article("guideline", {
    study_type: "clinical practice guideline",
    evidence_level: "clinical_practice_guideline",
  });
  const ranked = [
    guide,
    guideline,
    ...Array.from({ length: 8 }, (_, index) =>
      article(`cochrane-${index}`, {
        journal: "Cochrane Database of Systematic Reviews",
        retrieval_source_name: "Crossref",
      })
    ),
  ];
  const pubmed = Array.from({ length: 5 }, (_, index) =>
    article(`pubmed-${index}`, {
      pmid: String(index + 1),
      retrieval_source_name: "PubMed",
    })
  );

  const result = ensurePubMedRepresentation(ranked, [...ranked, ...pubmed], {
    displayLimit: 10,
    minimum: 5,
  });

  assert.equal(result.articles.length, 10);
  assert.ok(result.articles.some((item) => item.id === guide.id));
  assert.ok(result.articles.some((item) => item.id === guideline.id));
  assert.equal(result.articles.filter(isNonCochranePubMedArticle).length, 5);
  assert.equal(result.diagnostics.displayed_count, 5);
});

test("does not manufacture PubMed coverage when candidates are unavailable", () => {
  const articles = [article(1), article(2)];
  const result = ensurePubMedRepresentation(articles, articles, {
    displayLimit: 20,
    minimum: 5,
  });

  assert.deepEqual(result.articles, articles);
  assert.equal(result.diagnostics.displayed_count, 0);
});
