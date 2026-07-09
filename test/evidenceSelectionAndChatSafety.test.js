const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  getConditionMatch,
} = require("../src/services/conditionConcepts");
const {
  selectEvidenceForResponse,
} = require("../src/services/evidenceSelectionGuard");
const {
  sanitizeStructuredChatResponse,
} = require("../src/services/chatClaimSafety");

const combinedIntent = {
  condition: "neck pain and headache",
  body_region: "cervical spine and head",
  normalized_query: "neck pain and headache",
  search_terms: ["neck pain", "headache", "physiotherapy"],
};

function article(overrides = {}) {
  return {
    title: "Manual therapy and exercise for cervicogenic headache",
    abstract:
      "This systematic review included adults with cervicogenic headache and associated neck pain.",
    year: 2022,
    study_type: "systematic review",
    evidence_level: "systematic_review",
    evidence_level_label_es: "Revisión sistemática",
    evidence_level_label_en: "Systematic review",
    evidence_level_rank: 8,
    query_relevance_score: 72,
    reading_priority_score: 76,
    openphysio_evidence_score: 78,
    physiotherapy_relevance_score: 12,
    is_physiotherapy_relevant: true,
    ...overrides,
  };
}

test("combined neck and headache queries require both concepts", () => {
  const unrelated = getConditionMatch(
    article({
      title: "Drug therapy for post-dural puncture headache",
      abstract: "Pharmacological treatment after lumbar puncture.",
    }),
    combinedIntent
  );
  const relevant = getConditionMatch(article(), combinedIntent);

  assert.equal(unrelated.requires_all_groups, true);
  assert.equal(unrelated.matches, false);
  assert.equal(relevant.matches, true);
  assert.equal(relevant.matched_count, relevant.group_count);
});

test("evidence guard removes post-dural headache and collapses duplicate Cochrane versions", () => {
  const selection = selectEvidenceForResponse(
    [
      article({
        title: "Drug therapy for treating post-dural puncture headache",
        abstract: "Drug therapy after dural puncture.",
        is_physiotherapy_relevant: false,
        physiotherapy_relevance_score: 0,
      }),
      article({
        title:
          "Spinal rehabilitative exercise or manual treatment for the prevention of cervicogenic headache in adults",
        year: 2016,
      }),
      article({
        title:
          "Spinal rehabilitative exercise or manual treatment for the prevention of cervicogenic headache in adults",
        year: 2017,
        abstract:
          "This systematic review included adults with cervicogenic headache and neck pain.",
      }),
    ],
    combinedIntent,
    { limit: 10 }
  );

  assert.equal(selection.articles.length, 1);
  assert.doesNotMatch(selection.articles[0].title, /post-dural/i);
  assert.equal(selection.articles[0].year, 2017);
  assert.equal(selection.diagnostics.duplicate_collapsed_count, 1);
});

test("protocol records remain low-confidence evidence after condition matching", () => {
  const selection = selectEvidenceForResponse(
    [
      article({
        abstract:
          "This is the protocol for a review of exercise and manual therapy for cervicogenic headache and neck pain.",
        query_relevance_score: 90,
        reading_priority_score: 90,
      }),
    ],
    combinedIntent,
    { limit: 4 }
  );

  assert.equal(selection.articles[0].evidence_level, "preprint_or_unclear");
  assert.equal(selection.articles[0].evidence_level_rank, 1);
  assert.ok(selection.articles[0].query_relevance_score <= 48);
  assert.ok(selection.articles[0].reading_priority_score <= 38);
  assert.equal(
    selection.articles[0].preferred_source_key,
    "incomplete_protocol"
  );
});

test("uncited diagnostic criteria and vascular manipulation claims are removed", () => {
  const safe = sanitizeStructuredChatResponse(
    {
      brief_answer: [],
      clinical_application: [],
      assessment_considerations: [
        {
          text: "Use International Headache Society criteria and reproduce pain over cervical trigger points.",
          source_indices: [],
        },
        {
          text: "Assess symptom irritability, function, goals, and load tolerance.",
          source_indices: [],
        },
      ],
      precautions: [
        {
          text: "Avoid high velocity cervical manipulation when vascular compromise is suspected.",
          source_indices: [],
        },
      ],
      confidence: {
        level: "Limitado",
        level_key: "limited",
        score: 40,
        rationale: "Evidencia limitada.",
      },
    },
    { language: "es" }
  );

  const assessmentText = safe.assessment_considerations
    .map((item) => item.text)
    .join(" ");
  const precautionText = safe.precautions.map((item) => item.text).join(" ");

  assert.doesNotMatch(assessmentText, /International Headache Society/i);
  assert.doesNotMatch(assessmentText, /trigger points/i);
  assert.match(assessmentText, /irritability/i);
  assert.doesNotMatch(precautionText, /high velocity/i);
  assert.doesNotMatch(precautionText, /vascular/i);
  assert.match(precautionText, /evidencia recuperada es limitada/i);
});

test("Chat and Research routes apply the evidence selection guard", () => {
  const root = path.join(__dirname, "..");
  const chat = fs.readFileSync(path.join(root, "src/routes/chat.js"), "utf8");
  const research = fs.readFileSync(
    path.join(root, "src/routes/research.js"),
    "utf8"
  );

  assert.match(chat, /selectEvidenceForResponse/);
  assert.match(chat, /sanitizeStructuredChatResponse/);
  assert.match(chat, /evidenceSelectionVersion/);
  assert.match(research, /selectEvidenceForResponse/);
  assert.match(research, /evidenceSelectionVersion === "1\.1\.0"/);
});
