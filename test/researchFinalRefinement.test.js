const test = require("node:test");
const assert = require("node:assert/strict");

const {
  finalScope,
  refineResearchResultsFinal,
} = require("../src/services/researchFinalRefinement");
const {
  sanitizeFinalClaim,
} = require("../src/services/researchAnswerFinalSafety");
const {
  normalizeJournalName,
} = require("../src/services/researchSearchSummary");

const intent = {
  condition: "chronic low back pain",
  body_region: "lumbar spine",
  intervention: "exercise",
  normalized_query: "chronic low back pain exercise",
  search_terms: ["chronic low back pain", "exercise"],
};

function article(overrides = {}) {
  return {
    title: "Exercise therapy for chronic low back pain",
    abstract: "Exercise therapy in adults with chronic low back pain.",
    study_type: "systematic review",
    evidence_level: "systematic_review",
    evidence_level_rank: 8,
    query_relevance_score: 85,
    reading_priority_score: 82,
    openphysio_evidence_score: 82,
    physiotherapy_relevance_score: 12,
    is_physiotherapy_relevant: true,
    journal: "The Cochrane database of systematic reviews",
    year: 2021,
    ...overrides,
  };
}

test("broad exercise syntheses rank before manual-therapy comparisons", () => {
  const broad = article();
  const manual = article({
    title:
      "Exercise Therapy Versus Manual Therapy for Chronic Low Back Pain: A Systematic Review",
    journal: "European Journal of Pain",
  });

  assert.equal(
    finalScope(broad, { broad_exercise_question: true }),
    "broad_synthesis"
  );
  assert.equal(
    finalScope(manual, { broad_exercise_question: true }),
    "adjunct_or_comparator"
  );

  const result = refineResearchResultsFinal([manual, broad], intent, {
    query: "Dolor lumbar crónico y ejercicio",
    limit: 20,
  });

  assert.equal(result.articles[0].title, broad.title);
  assert.equal(result.articles[1].evidence_role, "complementary");
});

test("single-modality reviews are complementary for broad exercise questions", () => {
  const aerobic = article({
    title: "Aerobic exercise therapy for chronic low back pain",
    year: 2024,
  });
  const result = refineResearchResultsFinal([aerobic], intent, {
    query: "Dolor lumbar crónico y ejercicio",
    limit: 20,
  });

  assert.equal(result.articles[0].scope_match, "specific_modality");
  assert.equal(result.articles[0].evidence_role, "complementary");
});

test("missing journal metadata lowers priority and is exposed", () => {
  const complete = article({ reading_priority_score: 80 });
  const incomplete = article({
    title: "Exercise modalities and dose parameters for chronic low back pain",
    journal: null,
    reading_priority_score: 80,
  });
  const result = refineResearchResultsFinal([incomplete, complete], intent, {
    query: "Dolor lumbar crónico y ejercicio",
    limit: 20,
  });
  const missing = result.articles.find((item) => !item.journal);

  assert.equal(missing.bibliographic_metadata, "incomplete");
  assert.ok(missing.reading_priority_score < 80);
});

test("clinically relevant and manual-therapy increment claims are softened", () => {
  const exercise = sanitizeFinalClaim(
    {
      text: "Pilates y yoga muestran beneficios clínicamente relevantes.",
      source_indices: [1],
    },
    "es"
  );
  const manual = sanitizeFinalClaim(
    {
      text: "La terapia manual proporciona mejoras adicionales.",
      source_indices: [2],
    },
    "es"
  );

  assert.match(exercise.text, /pueden mejorar/i);
  assert.match(exercise.text, /magnitud del beneficio/i);
  assert.match(manual.text, /podría aportar/i);
  assert.match(manual.text, /certeza varían/i);
});

test("journal names are normalized consistently", () => {
  assert.equal(
    normalizeJournalName("Journal of orthopaedic surgery and research"),
    "Journal of Orthopaedic Surgery and Research"
  );
  assert.equal(normalizeJournalName("PloS one"), "PLOS ONE");
});
