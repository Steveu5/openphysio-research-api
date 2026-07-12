const test = require("node:test");
const assert = require("node:assert/strict");

const {
  refineResearchResults,
  sameReviewFamily,
} = require("../src/services/researchResultQuality");
const {
  buildSourceDiagnostics,
  buildSearchSummary,
} = require("../src/services/researchSearchSummary");
const {
  refineStructuredResearchAnswer,
} = require("../src/services/researchAnswerSafety");

const intent = {
  condition: "chronic low back pain",
  body_region: "lumbar spine",
  intervention: "exercise",
  normalized_query: "chronic low back pain and exercise",
  search_terms: ["chronic low back pain", "exercise"],
};

function article(overrides = {}) {
  return {
    title: "Exercise therapy for chronic low back pain",
    abstract:
      "Adults with chronic low back pain received exercise therapy.",
    year: 2024,
    journal: "Journal of Physiotherapy",
    study_type: "Systematic Review",
    evidence_level: "systematic_review",
    evidence_level_rank: 8,
    query_relevance_score: 85,
    reading_priority_score: 82,
    openphysio_evidence_score: 80,
    is_physiotherapy_relevant: true,
    physiotherapy_relevance_score: 10,
    retrieval_source_name: "PubMed",
    pmid: "100",
    ...overrides,
  };
}

test("Research removes pediatric and acute-only evidence from a chronic adult-oriented query", () => {
  const result = refineResearchResults(
    [
      article(),
      article({
        title:
          "Exercise for children and adolescents with chronic low back pain",
        pmid: "101",
      }),
      article({
        title: "Exercise therapy for acute nonspecific low back pain",
        pmid: "102",
      }),
    ],
    intent,
    { query: "Dolor lumbar crónico y ejercicio", limit: 20 }
  );

  assert.equal(result.articles.length, 1);
  assert.equal(result.diagnostics.population_mismatch_removed, 1);
  assert.equal(result.diagnostics.stage_mismatch_removed, 1);
});

test("Research removes protocols when sufficient completed evidence exists", () => {
  const completed = Array.from({ length: 8 }, (_, index) =>
    article({
      title: `Exercise therapy ${index + 1} for chronic low back pain`,
      pmid: String(200 + index),
    })
  );
  const protocol = article({
    title:
      "Exercise therapy for chronic low back pain: protocol for an individual participant data meta-analysis",
    abstract: "This is the protocol for a review.",
    study_type: "protocol",
    evidence_level: "preprint_or_unclear",
    pmid: "299",
  });

  const result = refineResearchResults(
    [...completed, protocol],
    intent,
    { query: "Dolor lumbar crónico y ejercicio", limit: 20 }
  );

  assert.equal(result.articles.some((item) => item.pmid === "299"), false);
  assert.equal(result.diagnostics.protocols_removed, 1);
});

test("generic older Cochrane review versions collapse without merging distinct modalities", () => {
  const current = article({
    title: "Exercise therapy for chronic low back pain",
    journal: "Cochrane Database of Systematic Reviews",
    year: 2021,
  });
  const old = article({
    title: "Exercise therapy for low-back pain",
    journal: "Cochrane Database of Systematic Reviews",
    year: 2000,
  });
  const aerobic = article({
    title: "Aerobic exercise therapy for chronic low back pain",
    journal: "Cochrane Database of Systematic Reviews",
    year: 2024,
  });

  assert.equal(sameReviewFamily(current, old), true);
  assert.equal(sameReviewFamily(current, aerobic), false);
});

test("database counts use primary retrieval source while PubMed indexing is reported separately", () => {
  const displayed = [
    article({ retrieval_source_name: "PubMed", pmid: "1" }),
    article({ retrieval_source_name: "Europe PMC", pmid: "2" }),
  ];
  const diagnostics = buildSourceDiagnostics(
    {},
    [
      {
        source: "pubmed",
        label: "PubMed",
        status: "ok",
        retrieved_count: 20,
        requests: 2,
      },
      {
        source: "europe_pmc",
        label: "Europe PMC",
        status: "ok",
        retrieved_count: 10,
        requests: 1,
      },
    ],
    displayed
  );

  const pubmed = diagnostics.find((item) => item.source === "pubmed");
  const europePmc = diagnostics.find((item) => item.source === "europe_pmc");

  assert.equal(pubmed.visible_primary_count, 1);
  assert.equal(pubmed.visible_indexed_count, 2);
  assert.equal(europePmc.visible_primary_count, 1);
});

test("search summary separates databases from journals and labels raw records", () => {
  const diagnostics = [
    {
      source: "pubmed",
      label: "PubMed",
      status: "ok",
      retrieved_count: 20,
      requests: 1,
    },
    {
      source: "crossref",
      label: "Crossref",
      status: "ok",
      retrieved_count: 5,
      requests: 1,
    },
  ];
  const summary = buildSearchSummary({
    sourceDiagnostics: diagnostics,
    displayedArticles: [
      article({ journal: "PloS one" }),
      article({ journal: "Journal of physiotherapy", pmid: "2" }),
    ],
  });

  assert.equal(summary.raw_records_retrieved, 25);
  assert.deepEqual(summary.databases_consulted, ["PubMed", "Crossref"]);
  assert.ok(summary.journals_represented.includes("PLOS ONE"));
  assert.ok(summary.journals_represented.includes("Journal of Physiotherapy"));
});

test("comparative claims become cautious and heterogeneous confidence is capped", () => {
  const articles = [
    article({ title: "Pilates for chronic low back pain" }),
    article({ title: "Yoga for chronic low back pain", pmid: "2" }),
    article({ title: "Motor control exercise for chronic low back pain", pmid: "3" }),
    article({ title: "Strength training for chronic low back pain", pmid: "4" }),
  ];
  const refined = refineStructuredResearchAnswer(
    {
      clinical_answer: [
        {
          text: "Pilates, yoga, motor control and McKenzie are beneficial and no modality is clearly superior.",
          source_indices: [1, 2, 3, 4],
        },
      ],
      key_findings: [],
      evidence_relationships: [],
      confidence: {},
    },
    { level: "Alto", level_key: "high", score: 96, rationale: "Alta." },
    articles,
    "es"
  );

  assert.match(
    refined.structured.clinical_answer[0].text,
    /superioridad comparativa no es uniforme/i
  );
  assert.ok(refined.confidence.score <= 88);
});
