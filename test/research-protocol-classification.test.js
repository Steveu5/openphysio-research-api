const test = require("node:test");
const assert = require("node:assert/strict");

const { describesPlannedStudy, countPlannedMethodVerbs, reportsResults } = require("../src/services/protocolSignals");
const { calculateEvidenceLevel } = require("../src/services/evidenceLevel");
const { isProtocolEvidence } = require("../src/services/evidenceSelectionGuard");
const { isCochraneDatabaseWork, normalizeCochraneWork } = require("../src/services/cochraneCrossref");

// Real abstracts (PubMed). Murphy 2018 (PMID 29653591, Syst Rev) is a review
// PROTOCOL whose title has no "protocol" keyword; Research ranked it first as a
// "systematic review and meta-analysis" (benchmark run nm_p0sub, 2026-09-30).
const MURPHY_2018_PROTOCOL = "BACKGROUND: Mid-portion Achilles tendinopathy (AT) is prevalent amongst athletic and non-athletic populations with pain, stiffness and impaired function typically reported. However, there has been no systematic review or meta-analysis completed to determine this. Furthermore, the narrative review did not consider wait-and-see or sham interventions, thus a systematic review and met-analysis which includes wait-and-see or sham interventions is warranted. METHODS: A systematic review and meta-analyses will be conducted as per the PRISMA guidelines. The databases PUBMED, CINAHL (Ovid) and CINAHL (EBSCO) will be searched for articles published from inception to 31 December 2017. Only randomised/ quasi-randomised trials will be included while case reports and case series will be excluded. Two reviewers will screen articles, extract data and assess the risk of bias independently with a third reviewer resolving any disagreements between the two reviewers. A meta-analysis will then be performed on the data (if appropriate). DISCUSSION: This systematic review and meta-analysis will allow us to investigate if there are difference in pain and function. SYSTEMATIC REVIEW REGISTRATION: PROSPERO registration number CRD42018084493.";

// Completed controls from the same search.
const WILSON_2018_REVIEW = "OBJECTIVES: To assess the efficacy of exercise, orthoses and splinting on function, pain and quality of life (QoL) for the management of mid-portion and insertional Achilles tendinopathy. DESIGN: Systematic review and meta-analysis. METHODS: Independent reviewers undertook searches, screening and risk of bias appraisal. RESULTS: Twenty-two studies were included (1137 participants). There was moderate level evidence of no significant difference in pain or function between eccentric exercise and heavy slow resistance exercise.";
const BEYER_2015_RCT = "PURPOSE: To evaluate the effectiveness of eccentric training (ECC) and heavy slow resistance training (HSR) among patients with midportion Achilles tendinopathy. STUDY DESIGN: Randomized controlled trial; Level of evidence, 1. METHODS: A total of 58 patients with chronic (>3 months) midportion Achilles tendinopathy were randomized to ECC or HSR for 12 weeks. RESULTS: Both groups showed significant (P < .0001) improvements from 0 to 12 weeks, and these improvements were maintained at the 52-week follow-up. CONCLUSION: HSR yields equally good results as ECC.";

function crossrefArticle(abstract) {
  // What the Cochrane-via-Crossref adapter produced for the protocol.
  return {
    title: "Is heavy eccentric calf training superior to wait-and-see, sham rehabilitation, traditional physiotherapy and other exercise interventions for pain and function in mid-portion Achilles tendinopathy?",
    abstract,
    study_type: "systematic review",
    journal: "Systematic Reviews",
    source_name: "Cochrane metadata via Crossref",
  };
}

test("a review protocol is recognised from its planned, future-tense methods", () => {
  assert.equal(countPlannedMethodVerbs(MURPHY_2018_PROTOCOL) >= 2, true);
  assert.equal(reportsResults(MURPHY_2018_PROTOCOL), false);
  assert.equal(describesPlannedStudy(MURPHY_2018_PROTOCOL), true);
});

test("the protocol is classified as a protocol even when metadata says systematic review", () => {
  const level = calculateEvidenceLevel(crossrefArticle(MURPHY_2018_PROTOCOL));
  assert.equal(level.evidence_level_rank, 1);
  assert.equal(level.evidence_level_label_en, "Protocol or incomplete evidence");
  assert.equal(isProtocolEvidence(crossrefArticle(MURPHY_2018_PROTOCOL)), true);
});

test("completed reviews and trials are never flagged as protocols", () => {
  for (const [abstract, studyType] of [
    [WILSON_2018_REVIEW, "systematic review and meta-analysis"],
    [BEYER_2015_RCT, "randomized controlled trial"],
  ]) {
    const article = { title: "Completed study", abstract, study_type: studyType };
    assert.equal(describesPlannedStudy(abstract), false);
    assert.equal(isProtocolEvidence(article), false);
    assert.notEqual(calculateEvidenceLevel(article).evidence_level_rank, 1);
  }
});

test("a completed review that mentions future research once stays a review", () => {
  const abstract = `${WILSON_2018_REVIEW} High-quality trials will be needed, and future reviews will be updated as new evidence emerges.`;
  assert.equal(describesPlannedStudy(abstract), false);
});

test("a single repeated planned step is not enough to call it a protocol", () => {
  assert.equal(describesPlannedStudy("Data will be extracted. More data will be extracted later."), false);
});

test("Cochrane protocol wording is detected", () => {
  const abstract = "This is a protocol for a Cochrane Review (intervention). The objectives are as follows: to assess the effects of exercise for Achilles tendinopathy.";
  assert.equal(describesPlannedStudy(abstract), true);
  assert.equal(isProtocolEvidence({ title: "Exercise for Achilles tendinopathy", abstract, study_type: "systematic review" }), true);
});

test("the Cochrane adapter keeps only Cochrane Database records", () => {
  assert.equal(isCochraneDatabaseWork({ "container-title": ["Cochrane Database of Systematic Reviews"] }), true);
  assert.equal(isCochraneDatabaseWork({ "container-title": ["Systematic Reviews"] }), false);
  assert.equal(isCochraneDatabaseWork({ "container-title": [] }), false);
  // The normalizer itself is unchanged.
  assert.equal(normalizeCochraneWork({ title: ["X"], "container-title": ["Cochrane Database of Systematic Reviews"] }).source_name, "Cochrane metadata via Crossref");
});
