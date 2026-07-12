const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isCervicogenicHeadacheQuery,
  refineLibraryGuidesForCervicogenicHeadache,
  refineCervicogenicHeadacheResults,
  refineCervicogenicHeadacheAnswer,
} = require("../src/services/cervicogenicHeadacheRefinement");

test("detects cervicogenic headache in Spanish", () => {
  assert.equal(
    isCervicogenicHeadacheQuery(
      "Dolor cervical asociado a cefalea cervicogénica",
      {}
    ),
    true
  );
});

test("uses the neck guideline as a related framework", () => {
  const [guide] = refineLibraryGuidesForCervicogenicHeadache(
    [
      {
        title: "Neck Pain: Revision 2017",
        guideline_applicability: "direct",
        query_relevance_score: 94,
        reading_priority_score: 96,
        library_resource: { applicability: "direct" },
      },
    ],
    "cefalea cervicogénica",
    {}
  );

  assert.equal(guide.guideline_applicability, "component_framework");
  assert.equal(guide.evidence_role, "complementary");
  assert.match(guide.guideline_scope_note_es, /no sustituye/i);
});

test("prioritizes condition-specific evidence over generic neck pain", () => {
  const result = refineCervicogenicHeadacheResults(
    [
      {
        title: "Manual therapy with exercise for neck pain",
        study_type: "Systematic Review",
        evidence_level_rank: 8,
        query_relevance_score: 80,
        reading_priority_score: 85,
      },
      {
        title: "Exercise and manipulative therapy for cervicogenic headache",
        study_type: "Randomized Controlled Trial",
        evidence_level_rank: 6,
        query_relevance_score: 72,
        reading_priority_score: 70,
      },
    ],
    "cefalea cervicogénica",
    {},
    { limit: 20, baseDiagnostics: {} }
  );

  assert.match(result.articles[0].title, /cervicogenic headache/i);
  assert.equal(result.articles[0].evidence_role, "primary");
  assert.equal(result.articles[1].evidence_role, "complementary");
});

test("removes context-only claims and caps confidence", () => {
  const articles = [
    {
      title: "Temporomandibular disorders in cervicogenic headache",
      evidence_role: "context",
      study_type: "Systematic Review",
    },
    {
      title: "Exercise for cervicogenic headache",
      evidence_role: "primary",
      study_type: "Randomized Controlled Trial",
    },
  ];
  const result = refineCervicogenicHeadacheAnswer(
    {
      structured: {
        clinical_answer: [
          { text: "TMD is common.", source_indices: [1] },
          { text: "Exercise improves pain.", source_indices: [2] },
        ],
        key_findings: [],
        evidence_relationships: [],
      },
      confidence: { score: 92 },
    },
    articles,
    "cervicogenic headache",
    {},
    "en"
  );

  assert.equal(result.structured.clinical_answer.length, 1);
  assert.match(result.structured.clinical_answer[0].text, /suggests/i);
  assert.ok(result.confidence.score <= 84);
});
