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
