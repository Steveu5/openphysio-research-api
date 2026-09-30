const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { normalizeClinicalQuestion } = require("../src/services/clinicalQuestion");
const { applicableLibraryGuides } = require("../src/services/libraryEvidenceIntegration");
const { refineStructuredClinicalChatFinal, renderConciseChatReply } = require("../src/services/chatFinalRefinement");

const guide = (slug, title, abstract) => ({
  id: `library:${slug}`,
  title,
  abstract,
  study_type: "clinical practice guideline",
  evidence_level_rank: 10,
  year: 2019,
  library_resource: { slug, applicability: "regional_framework" },
});

const pfpGuide = guide("pfp", "Patellofemoral Pain", "Guideline on knee pain, exercise and hip and knee strengthening.");
const neckGuide = guide("neck", "Neck Pain: Revision 2017", "Guideline on neck pain: exercise and manual therapy.");

test("an underspecified knee question does not inherit a Library guide for a specific diagnosis", () => {
  const broadKnee = normalizeClinicalQuestion({ normalized_query: "knee pain physiotherapy management", question_type: "treatment" });
  assert.deepEqual(applicableLibraryGuides([pfpGuide], broadKnee, { mode: "chat" }), []);
});

test("another knee diagnosis does not receive the patellofemoral guide", () => {
  for (const intent of [
    { condition: "patellar tendinopathy", intervention: "exercise", question_type: "treatment" },
    { normalized_query: "lateral knee pain in runners: assessment and treatment approach", population: "runners", question_type: "treatment" },
    { condition: "knee osteoarthritis", intervention: "exercise", question_type: "treatment" },
  ]) {
    const guides = applicableLibraryGuides([pfpGuide], normalizeClinicalQuestion(intent), { mode: "research" });
    assert.deepEqual(guides, [], JSON.stringify(intent));
  }
});

test("a Library guide for the condition asked is kept", () => {
  const pfp = normalizeClinicalQuestion({ condition: "patellofemoral pain", intervention: "exercise", question_type: "treatment" });
  const neck = normalizeClinicalQuestion({ condition: "chronic neck pain", intervention: "exercise", question_type: "treatment" });
  assert.equal(applicableLibraryGuides([pfpGuide], pfp, { mode: "chat" }).length, 1);
  assert.equal(applicableLibraryGuides([neckGuide], neck, { mode: "research" }).length, 1);
});

test("a headache or neck question keeps the model's own answer; no cervicogenic text is injected", () => {
  const structured = {
    brief_answer: [{ text: "Exercise may reduce the frequency of tension-type headache.", source_indices: [1] }],
    confidence: {},
  };
  const refined = refineStructuredClinicalChatFinal(structured, [{ title: "Exercise for tension-type headache", study_type: "systematic review" }], "en");
  const reply = renderConciseChatReply(refined, "en");
  assert.match(reply, /tension-type headache/);
  assert.doesNotMatch(reply, /cervicogenic/i);
});

// The answer pipeline decides from PICO, the clinical match and the evidence
// itself. Condition vocabulary lives only in the dictionaries
// (conditionConcepts, preferredGuidelineSearch, clinicalMatch, Library
// matching) and in safety/retrieval data; routes and answer passes must not
// special-case a condition.
test("routes and answer refinement passes contain no condition-specific rules", () => {
  const root = path.resolve(__dirname, "../src");
  const files = [
    "routes/chat.js",
    "routes/research.js",
    "services/chatFinalRefinement.js",
    "services/researchFinalRefinement.js",
    "services/libraryEvidenceIntegration.js",
    "services/libraryRecommendationPolicy.js",
  ];
  const conditionPattern = /cervicogen|patell?ofemoral|rodilla|\bknee\b|cefalea|headache|\bneck\b|cervical/i;
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.ok(!conditionPattern.test(source), `${file}: ${source.match(conditionPattern)?.[0]}`);
  }
  for (const removed of [
    "services/cervicogenicHeadacheRefinement.js",
    "services/cervicogenicHeadacheFinalPass.js",
    "services/chatContinuationGuidance.js",
  ]) {
    assert.equal(fs.existsSync(path.join(root, removed)), false, removed);
  }
});

// Headache family (P2.2 containment check). Intents are the parser output
// recorded in the local benchmark: tension-type headache arrives with "cervicogenic headache" among
// its condition terms, and migraine with "headache".
const { selectEvidenceForResponse } = require("../src/services/evidenceSelectionGuard");
const { refineResearchResultsFinal } = require("../src/services/researchFinalRefinement");
const { rankByClinicalMatch } = require("../src/services/clinicalMatch");
const { assessChatEvidence } = require("../src/services/chatEvidenceAssessment");
const { annotateSourcePriority } = require("../src/services/sourcePriority");

const headacheArticle = (title, pmid, studyType = "systematic review") => ({
  title,
  pmid,
  abstract: `${title}. Physiotherapy, exercise and manual therapy.`,
  study_type: studyType,
  evidence_level_rank: 9,
  year: 2022,
});
const headachePool = [
  headacheArticle("Efficacy of physiotherapy interventions for the management of adults with cervicogenic headache: a systematic review", "1001"),
  headacheArticle("Spinal rehabilitative exercise or manual treatment for the prevention of cervicogenic headache in adults", "1002"),
  headacheArticle("Exercise therapy for tension-type headache: a systematic review and meta-analysis", "1003"),
  headacheArticle("Aerobic exercise for migraine prevention: a systematic review and meta-analysis", "1004"),
];
const CGH_ONLY = /cervicogenic headache/i;

function visibleChatSources(rawIntent) {
  const intent = normalizeClinicalQuestion(rawIntent);
  const annotated = headachePool.map((article) => annotateSourcePriority(article, intent));
  const selected = selectEvidenceForResponse(annotated, intent, { limit: 20 });
  const refined = refineResearchResultsFinal(selected.articles, intent, { query: "", limit: 20 });
  const ranked = rankByClinicalMatch(refined.articles, intent, { mode: "chat" });
  return { ranked, cited: assessChatEvidence(ranked, intent, "es").citedArticles };
}

test("true cervicogenic headache keeps direct CGH evidence", () => {
  const { ranked, cited } = visibleChatSources({
    condition: "cervicogenic headache",
    condition_terms: ["cervicogenic headache", "cervical headache"],
    intervention: "physiotherapy",
    question_type: "treatment",
  });
  assert.ok(ranked.length >= 2);
  assert.ok(cited.every((article) => CGH_ONLY.test(article.title)));
  assert.ok(cited.every((article) => article.clinical_match.tier === "direct"));
});

// Former P2.2 gaps, closed by the condition hierarchy (#43): a sibling
// headache source is never direct, even with the parser's sibling terms.
test("tension-type headache cannot inherit CGH evidence as direct", () => {
  const { ranked } = visibleChatSources({
    condition: "episodic tension-type headache",
    condition_terms: ["episodic tension-type headache", "tension-type headache", "tension headache", "cervicogenic headache", "neck pain"],
    body_region: "cervical spine",
    intervention: "exercise therapy",
    intervention_terms: ["exercise", "exercise therapy", "therapeutic exercise", "physical therapy", "physiotherapy"],
    question_type: "treatment",
  });
  const inherited = ranked.filter((article) => CGH_ONLY.test(article.title) && article.clinical_match.tier === "direct");
  assert.deepEqual(inherited.map((article) => article.title), []);
});

test("migraine cannot inherit CGH evidence as direct", () => {
  const { ranked } = visibleChatSources({
    condition: "migraine",
    condition_terms: ["migraine", "migraine disorders", "migraine headache", "headache"],
    search_terms: ["migraine", "aerobic exercise", "exercise", "migraine frequency", "headache frequency", "physical activity"],
    body_region: "head",
    intervention: "aerobic exercise",
    intervention_terms: ["aerobic exercise", "exercise", "physical activity", "aerobic training", "cardio"],
    question_type: "treatment",
  });
  const inherited = ranked.filter((article) => CGH_ONLY.test(article.title) && article.clinical_match.tier === "direct");
  assert.deepEqual(inherited.map((article) => article.title), []);
});
