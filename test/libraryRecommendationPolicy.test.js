const test = require("node:test");
const assert = require("node:assert/strict");

const {
  selectLibraryRecommendations,
} = require("../src/services/libraryRecommendationPolicy");

function guide(slug, applicability, overrides = {}) {
  return {
    title: slug,
    source_index: overrides.source_index || null,
    query_relevance_score: overrides.query_relevance_score || 70,
    reading_priority_score: overrides.reading_priority_score || 80,
    year: overrides.year || 2024,
    guideline_applicability: applicability,
    guideline_scope_note_es: overrides.scope_note || null,
    library_resource: {
      id: slug,
      slug,
      title: overrides.title || slug,
      applicability,
      links: {
        report: `/library?guide=${slug}&resource=report`,
        audio: `/library?guide=${slug}&resource=audio`,
        infographics: `/library?guide=${slug}&resource=infographics`,
      },
    },
  };
}

test("selects one directly applicable guide over regional alternatives", () => {
  const recommendations = selectLibraryRecommendations([
    guide("regional-knee", "regional_framework", {
      query_relevance_score: 95,
    }),
    guide("direct-acl", "direct", {
      query_relevance_score: 88,
      source_index: 2,
    }),
  ]);

  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0].slug, "direct-acl");
  assert.equal(recommendations[0].applicability, "direct");
  assert.equal(recommendations[0].recommendation_confidence, "high");
  assert.equal(recommendations[0].source_index, 2);
});

test("keeps a single contextual guide when no direct guide exists", () => {
  const recommendations = selectLibraryRecommendations([
    guide("older-shoulder", "regional_framework", { year: 2018 }),
    guide("newer-shoulder", "regional_framework", { year: 2025 }),
  ]);

  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0].slug, "newer-shoulder");
  assert.equal(recommendations[0].recommendation_confidence, "contextual");
});

test("deduplicates the same Library guide and preserves exact links", () => {
  const first = guide("lumbar-guide", "direct");
  const duplicate = guide("lumbar-guide", "direct", {
    query_relevance_score: 99,
  });
  const recommendations = selectLibraryRecommendations([first, duplicate]);

  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0].source_index, null);
  assert.match(recommendations[0].links.report, /guide=lumbar-guide/);
  assert.match(recommendations[0].links.audio, /resource=audio/);
});

test("does not invent a recommendation without a linkable Library resource", () => {
  assert.deepEqual(
    selectLibraryRecommendations([
      { title: "External guideline", evidence_level: "guideline" },
    ]),
    []
  );
});
