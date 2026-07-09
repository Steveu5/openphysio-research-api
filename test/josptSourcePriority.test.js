const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildJosptGuidelineQueries,
} = require("../src/services/josptGuidelineSearch");
const {
  isGuideline,
  getPreferredSourcePriority,
  getEvidenceBasis,
  injectEvidenceBasisIntoReply,
} = require("../src/services/sourcePriority");
const {
  selectEvidenceForResponse,
} = require("../src/services/evidenceSelectionGuard");

const intent = {
  condition: "neck pain and headache",
  body_region: "cervical spine",
  normalized_query: "neck pain and cervicogenic headache",
  search_terms: ["neck pain", "cervicogenic headache", "physiotherapy"],
};

function baseArticle(overrides = {}) {
  return {
    title: "Clinical evidence for neck pain",
    abstract:
      "This article addresses neck pain and cervicogenic headache in physical therapy.",
    year: 2022,
    study_type: "systematic review",
    evidence_level: "systematic_review",
    evidence_level_rank: 8,
    query_relevance_score: 78,
    reading_priority_score: 79,
    openphysio_evidence_score: 80,
    physiotherapy_relevance_score: 12,
    is_physiotherapy_relevant: true,
    ...overrides,
  };
}

test("targeted JOSPT queries use PubMed journal and guideline filters", () => {
  const queries = buildJosptGuidelineQueries(intent, "neck pain");

  assert.ok(queries.length > 0);
  assert.ok(
    queries.every((query) =>
      query.includes('"J Orthop Sports Phys Ther"[Journal]')
    )
  );
  assert.ok(
    queries.every((query) => query.includes('"Practice Guideline"'))
  );
});

test("source priority is JOSPT guideline then Cochrane then PubMed", () => {
  const jospt = getPreferredSourcePriority(
    baseArticle({
      title: "Neck Pain: Revision 2017",
      journal: "Journal of Orthopaedic & Sports Physical Therapy",
      study_type: "Practice Guideline",
      evidence_level: "clinical_practice_guideline",
      evidence_level_rank: 10,
      pmid: "28666405",
      retrieval_source_name: "PubMed",
    })
  );
  const cochrane = getPreferredSourcePriority(
    baseArticle({
      journal: "Cochrane Database of Systematic Reviews",
      source_name: "Cochrane",
    })
  );
  const pubmed = getPreferredSourcePriority(
    baseArticle({ pmid: "123456", retrieval_source_name: "PubMed" })
  );

  assert.equal(jospt.key, "jospt_guideline");
  assert.equal(cochrane.key, "cochrane_review");
  assert.equal(pubmed.key, "pubmed_evidence");
  assert.ok(jospt.tier > cochrane.tier);
  assert.ok(cochrane.tier > pubmed.tier);
});

test("a JOSPT adherence study is not mislabeled as a clinical guideline", () => {
  const adherenceStudy = baseArticle({
    title:
      "Adherence to clinical practice guidelines among physical therapists",
    journal: "Journal of Orthopaedic & Sports Physical Therapy",
    study_type: "cross-sectional study",
    evidence_level: "cross_sectional",
    evidence_level_rank: 3,
  });

  assert.equal(isGuideline(adherenceStudy), false);
  assert.notEqual(
    getPreferredSourcePriority(adherenceStudy).key,
    "jospt_guideline"
  );
});

test("evidence selection puts a relevant JOSPT guideline first", () => {
  const selected = selectEvidenceForResponse(
    [
      baseArticle({
        title: "Manual therapy for cervicogenic headache",
        journal: "Cochrane Database of Systematic Reviews",
        source_name: "Cochrane",
      }),
      baseArticle({
        title: "Neck Pain: Revision 2017",
        journal: "Journal of Orthopaedic & Sports Physical Therapy",
        study_type: "Practice Guideline",
        evidence_level: "clinical_practice_guideline",
        evidence_level_rank: 10,
        pmid: "28666405",
        retrieval_source_name: "PubMed",
      }),
      baseArticle({
        title: "Exercise for neck pain and headache",
        pmid: "999999",
        retrieval_source_name: "PubMed",
      }),
    ],
    intent,
    { limit: 10 }
  );

  assert.equal(
    selected.articles[0].preferred_source_key,
    "jospt_guideline"
  );
  assert.equal(
    selected.articles[1].preferred_source_key,
    "cochrane_review"
  );
  assert.equal(selected.diagnostics.jospt_guideline_count, 1);
  assert.equal(selected.diagnostics.cochrane_count, 1);
});

test("response states JOSPT basis only when a real JOSPT guideline exists", () => {
  const articles = [
    baseArticle({
      title: "Neck Pain: Revision 2017",
      journal: "J Orthop Sports Phys Ther",
      study_type: "Practice Guideline",
      evidence_level: "clinical_practice_guideline",
      evidence_level_rank: 10,
      pmid: "28666405",
    }),
  ];
  const basis = getEvidenceBasis(articles, "es");
  const reply = injectEvidenceBasisIntoReply(
    "Respuesta clínica\nEl tratamiento debe individualizarse.",
    basis,
    "es"
  );

  assert.equal(basis.jospt_guideline_found, true);
  assert.equal(basis.key, "jospt_guideline");
  assert.match(reply, /Base principal de evidencia: Guía clínica JOSPT\/AOPT/);
  assert.match(reply, /\[1\]/);
});

test("response explicitly avoids claiming JOSPT when none was recovered", () => {
  const basis = getEvidenceBasis(
    [
      baseArticle({
        source_name: null,
        retrieval_source_name: null,
        pmid: null,
      }),
    ],
    "es"
  );

  assert.equal(basis.jospt_guideline_found, false);
  assert.equal(basis.available, false);
  assert.match(basis.explanation, /no debe presentarse como basada en JOSPT/i);
});

test("Chat and Research expose evidence basis and source priority versions", () => {
  const root = path.join(__dirname, "..");
  const chat = fs.readFileSync(path.join(root, "src/routes/chat.js"), "utf8");
  const research = fs.readFileSync(
    path.join(root, "src/routes/research.js"),
    "utf8"
  );
  const engine = fs.readFileSync(
    path.join(root, "src/services/evidenceSearchEngine.js"),
    "utf8"
  );

  assert.match(chat, /evidenceBasis/);
  assert.match(chat, /sourcePriorityVersion: "1\.0\.0"/);
  assert.match(research, /evidenceBasis/);
  assert.match(research, /sourcePriorityVersion: "1\.0\.0"/);
  assert.match(engine, /searchJosptGuidelines/);
  assert.match(engine, /targeted_jospt_guidelines: true/);
});
