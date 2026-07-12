const test = require("node:test");
const assert = require("node:assert/strict");

const {
  queryScope,
  refineResearchResults,
} = require("../src/services/researchResultQuality");
const {
  buildSourceDiagnostics,
  buildSearchSummary,
  normalizeJournalName,
} = require("../src/services/researchSearchSummary");
const {
  sanitizeClaim,
} = require("../src/services/researchAnswerSafety");

const intent = {
  condition: "chronic low back pain",
  body_region: "lumbar spine",
  intervention: "exercise",
  population: "adults",
  normalized_query: "chronic low back pain and exercise",
  search_terms: ["chronic low back pain", "exercise"],
};

function article(overrides = {}) {
  return {
    title: "Exercise therapy for chronic low back pain",
    abstract:
      "Exercise therapy may improve pain and disability in adults with chronic low back pain.",
    year: 2021,
    study_type: "systematic review and meta-analysis",
    evidence_level: "systematic_review_meta_analysis",
    evidence_level_rank: 9,
    query_relevance_score: 85,
    reading_priority_score: 84,
    openphysio_evidence_score: 84,
    physiotherapy_relevance_score: 12,
    is_physiotherapy_relevant: true,
    journal: "The Cochrane database of systematic reviews",
    retrieval_source_name: "PubMed",
    pmid: "123",
    ...overrides,
  };
}

test("a general exercise query is detected as broad", () => {
  const scope = queryScope("Dolor lumbar crónico y ejercicio", intent);
  assert.equal(scope.broad_exercise_question, true);
  assert.deepEqual(scope.specific_modalities, []);
});

test("broad syntheses rank before modality-specific reviews and trials", () => {
  const result = refineResearchResults(
    [
      article({
        title: "Yoga for chronic low back pain: systematic review and meta-analysis",
        journal: "PLOS ONE",
        pmid: "124",
      }),
      article({
        title: "Exercise therapy for chronic low back pain",
        pmid: "123",
      }),
      article({
        title:
          "Impact of a combined exercise programme in athletes with chronic low back pain: randomized trial",
        study_type: "randomized controlled trial",
        evidence_level: "randomized_controlled_trial",
        evidence_level_rank: 7,
        journal: "Sports Medicine",
        pmid: "125",
      }),
      article({
        title: "Interventions for the Management of Acute and Chronic Low Back Pain: Revision 2021",
        abstract: "Clinical practice guideline for adults with low back pain.",
        study_type: "clinical practice guideline",
        evidence_level: "clinical_practice_guideline",
        evidence_level_rank: 10,
        journal: "JOSPT",
        library_resource: { slug: "low-back-pain-guideline" },
        query_relevance_score: 94,
        reading_priority_score: 96,
        pmid: null,
      }),
    ],
    intent,
    { query: "Dolor lumbar crónico y ejercicio", limit: 20 }
  );

  assert.match(result.articles[0].title, /Revision 2021/);
  assert.match(result.articles[1].title, /^Exercise therapy/);
  assert.equal(result.articles[2].clinical_directness, "complementary");
  assert.equal(result.articles[2].scope_match, "specific_context");
  assert.equal(result.articles[3].clinical_directness, "complementary");
  assert.equal(result.diagnostics.direct_count, 2);
  assert.equal(result.diagnostics.complementary_count, 2);
  assert.equal(result.diagnostics.query_scope, "broad_exercise");
});

test("all contacted databases are counted even when one yields no visible article", () => {
  const live = [
    { source: "pubmed", status: "ok", retrieved_count: 45, requests: 3 },
    { source: "europe_pmc", status: "ok", retrieved_count: 10, requests: 1 },
    {
      source: "openalex",
      status: "searched_no_selected_results",
      retrieved_count: 0,
      requests: 1,
    },
    { source: "crossref", status: "ok", retrieved_count: 4, requests: 1 },
  ];
  const displayed = [
    article({ retrieval_source_name: "PubMed" }),
    article({
      title: "Another review of exercise for chronic low back pain",
      retrieval_source_name: "Europe PMC",
      pmid: null,
      journal: "Journal of Physiotherapy",
    }),
  ];

  const diagnostics = buildSourceDiagnostics({}, live, displayed);
  const summary = buildSearchSummary({
    sourceDiagnostics: diagnostics,
    displayedArticles: displayed,
    qualityDiagnostics: { direct_count: 1, complementary_count: 1 },
  });

  assert.equal(summary.databases_consulted_count, 4);
  assert.equal(summary.databases_with_visible_articles_count, 2);
  assert.equal(summary.direct_articles, 1);
  assert.equal(summary.complementary_articles, 1);
});

test("journal names are normalized for display", () => {
  assert.equal(
    normalizeJournalName("The Cochrane database of systematic reviews"),
    "Cochrane Database of Systematic Reviews"
  );
  assert.equal(normalizeJournalName("PloS one"), "PLOS ONE");
  assert.equal(
    normalizeJournalName("Journal of bodywork and movement therapies"),
    "Journal of Bodywork and Movement Therapies"
  );
});

test("unsupported clinically important wording is moderated", () => {
  const safe = sanitizeClaim(
    {
      text: "Pilates and yoga show clinically important benefits.",
      source_indices: [1],
    },
    [
      article({
        title: "Pilates and yoga for chronic low back pain",
        abstract: "Both approaches may improve pain and disability.",
      }),
    ],
    "es"
  );

  assert.doesNotMatch(safe.text, /clínicamente importantes/i);
  assert.match(safe.text, /magnitud del efecto y la certeza varían/i);
});
