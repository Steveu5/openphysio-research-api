const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeClinicalQuestion } = require("../src/services/clinicalQuestion");
const { scoreClinicalMatch, rankByClinicalMatch } = require("../src/services/clinicalMatch");
const { conditionRelationship, classifyConditionTerm } = require("../src/services/conditionHierarchy");
const { selectEvidenceForResponse } = require("../src/services/evidenceSelectionGuard");
const { refineResearchResultsFinal } = require("../src/services/researchFinalRefinement");
const { assessChatEvidence } = require("../src/services/chatEvidenceAssessment");
const { annotateSourcePriority } = require("../src/services/sourcePriority");

const article = (title, pmid, studyType = "systematic review", extra = {}) => ({
  title,
  pmid,
  abstract: `${title}. Physiotherapy, exercise and manual therapy.`,
  study_type: studyType,
  evidence_level_rank: 9,
  year: 2022,
  ...extra,
});

// Parser output recorded in the local benchmark: tension-type headache came
// with "cervicogenic headache" among its condition terms and migraine with the
// umbrella "headache".
const INTENTS = {
  migraine: {
    condition: "migraine",
    condition_terms: ["migraine", "migraine disorders", "migraine headache", "headache"],
    search_terms: ["migraine", "aerobic exercise", "exercise", "migraine frequency", "headache frequency", "physical activity"],
    body_region: "head",
    intervention: "aerobic exercise",
    intervention_terms: ["aerobic exercise", "exercise", "physical activity", "aerobic training", "cardio"],
    question_type: "treatment",
  },
  tensionType: {
    condition: "episodic tension-type headache",
    condition_terms: ["episodic tension-type headache", "tension-type headache", "tension headache", "cervicogenic headache", "neck pain"],
    population: "patients with episodic tension-type headache and associated neck pain",
    body_region: "cervical spine",
    intervention: "exercise therapy",
    intervention_terms: ["exercise", "exercise therapy", "therapeutic exercise", "physical therapy", "physiotherapy"],
    question_type: "treatment",
  },
  cervicogenic: {
    condition: "cervicogenic headache",
    condition_terms: ["cervicogenic headache", "cervicogenic cephalalgia", "cervical headache", "headache of cervical origin"],
    body_region: "cervical spine",
    intervention: "physiotherapy",
    intervention_terms: ["physiotherapy", "physical therapy", "manual therapy", "exercise therapy", "rehabilitation"],
    question_type: "treatment",
  },
};

const HEADACHE_POOL = [
  article("Efficacy of physiotherapy interventions for the management of adults with cervicogenic headache: a systematic review", "1001"),
  article("Spinal rehabilitative exercise or manual treatment for the prevention of cervicogenic headache in adults", "1002"),
  article("Exercise therapy for tension-type headache: a systematic review and meta-analysis", "1003"),
  article("Aerobic exercise for migraine prevention: a systematic review and meta-analysis", "1004"),
  article("Aerobic training and migraine frequency: a randomized controlled trial", "1005", "randomized controlled trial"),
];
const CGH_ONLY = /cervicogenic headache/i;

// The same path the routes use: selection, final refinement, clinical
// ranking and, for Chat, the cited sources.
function visible(rawIntent, mode = "chat") {
  const intent = normalizeClinicalQuestion(rawIntent);
  const annotated = HEADACHE_POOL.map((item) => annotateSourcePriority(item, intent));
  const selected = selectEvidenceForResponse(annotated, intent, { limit: 20 });
  const refined = refineResearchResultsFinal(selected.articles, intent, { query: "", limit: 20 });
  const ranked = rankByClinicalMatch(refined.articles, intent, { mode });
  const cited = mode === "chat" ? assessChatEvidence(ranked, intent, "es").citedArticles : [];
  return { intent, ranked, cited };
}

const inheritedCgh = (list) =>
  list.filter((item) => CGH_ONLY.test(item.title) && item.clinical_match.tier === "direct");

test("A. migraine cannot inherit CGH-only evidence as direct", () => {
  for (const mode of ["chat", "research"]) {
    const { ranked, cited } = visible(INTENTS.migraine, mode);
    assert.deepEqual(inheritedCgh(ranked).map((item) => item.title), [], mode);
    assert.ok(cited.every((item) => !CGH_ONLY.test(item.title)), mode);
  }
  const { ranked } = visible(INTENTS.migraine, "chat");
  assert.ok(ranked.some((item) => /migraine/i.test(item.title) && item.clinical_match.tier === "direct"));
});

test("B. tension-type headache cannot inherit CGH-only evidence as direct", () => {
  for (const mode of ["chat", "research"]) {
    const { intent, ranked } = visible(INTENTS.tensionType, mode);
    assert.deepEqual(inheritedCgh(ranked).map((item) => item.title), [], mode);
    // The sibling term added by the parser no longer counts as a synonym.
    assert.equal(intent.condition_terms.includes("cervicogenic headache"), false);
    assert.equal(intent.condition_term_relations["cervicogenic headache"], "sibling");
  }
});

test("C. true cervicogenic headache keeps CGH evidence direct", () => {
  const { ranked, cited } = visible(INTENTS.cervicogenic, "chat");
  const cgh = ranked.filter((item) => CGH_ONLY.test(item.title));
  assert.ok(cgh.length >= 2);
  assert.ok(cgh.every((item) => item.clinical_match.tier === "direct"));
  assert.ok(cited.length >= 2 && cited.every((item) => CGH_ONLY.test(item.title)));
});

test("D. a framework guideline cannot become direct for a condition it does not name", () => {
  const neckGuideline = {
    ...article("Neck Pain: Revision 2017", "2001", "clinical practice guideline", { evidence_level_rank: 10 }),
    guideline_applicability: "related_cervical_component",
  };
  const tensionType = normalizeClinicalQuestion(INTENTS.tensionType);
  assert.notEqual(scoreClinicalMatch(neckGuideline, tensionType, { mode: "chat" }).tier, "direct");

  // An explicit framework scope is a ceiling even when the condition is
  // unknown to the hierarchy.
  const regionalGuide = {
    ...article("Spine rehabilitation guideline", "2002", "clinical practice guideline", { evidence_level_rank: 10 }),
    library_resource: { slug: "spine", applicability: "regional_framework" },
  };
  const scoliosis = normalizeClinicalQuestion({ condition: "adolescent idiopathic scoliosis", intervention: "exercise", question_type: "treatment" });
  const regional = scoreClinicalMatch(
    { ...regionalGuide, title: "Adolescent idiopathic scoliosis exercise guideline" },
    scoliosis,
    { mode: "research" }
  );
  assert.equal(regional.tier, "partial");
  assert.ok(regional.reasons.some((reason) => /guideline scope/.test(reason)));

  // A framework-labelled guideline that names the asked condition keeps its tier.
  const neckPain = normalizeClinicalQuestion({ condition: "chronic neck pain", intervention: "exercise", question_type: "treatment" });
  assert.equal(scoreClinicalMatch({ ...neckGuideline, title: "Neck Pain: exercise guideline" }, neckPain, { mode: "chat" }).tier, "direct");
});

test("E. broad knee pain: a diagnosis-specific guideline is not direct only because it shares 'knee pain'", () => {
  const broadKnee = normalizeClinicalQuestion({ normalized_query: "knee pain physiotherapy management", question_type: "treatment" });
  for (const title of [
    "Knee Pain and Mobility Impairments: Meniscal and Articular Cartilage Lesions Revision 2018",
    "A clinical practice guideline for physical therapy in patients with hip or knee osteoarthritis",
  ]) {
    const match = scoreClinicalMatch(article(title, "3001", "clinical practice guideline"), broadKnee, { mode: "chat" });
    assert.notEqual(match.tier, "direct", title);
    assert.equal(match.condition_relation, "child", title);
  }
});

test("F. patellar tendinopathy: patellofemoral pain is a sibling, never direct", () => {
  const intent = normalizeClinicalQuestion({
    condition: "patellar tendinopathy",
    condition_terms: ["jumper's knee", "patellar tendinitis", "anterior knee pain", "patellofemoral pain"],
    intervention: "exercise",
    question_type: "treatment",
  });
  assert.equal(intent.condition_terms.includes("patellofemoral pain"), false);
  const pfp = scoreClinicalMatch(article("Exercise therapy for patellofemoral pain: a systematic review", "4001"), intent, { mode: "chat" });
  assert.equal(pfp.tier, "tangential");
  assert.equal(pfp.condition_relation, "sibling");
  assert.equal(pfp.competing_condition, true);
});

test("G. a broad headache question: subtype evidence is useful but not exact", () => {
  const intent = normalizeClinicalQuestion({ condition: "headache", intervention: "exercise", question_type: "treatment" });
  const migraine = scoreClinicalMatch(article("Exercise for migraine: a systematic review", "5001"), intent, { mode: "chat" });
  assert.equal(migraine.condition_relation, "child");
  assert.notEqual(migraine.tier, "direct");
  const umbrella = scoreClinicalMatch(article("Exercise for headache disorders: a systematic review", "5002"), intent, { mode: "chat" });
  assert.equal(umbrella.tier, "direct");
});

test("H. real exact matches are not downgraded", () => {
  const cases = [
    [INTENTS.migraine, "How much aerobic exercise is needed to reduce migraine? A dose-response meta-analysis"],
    [INTENTS.tensionType, "Exercise therapy for tension-type headache and neck pain: a systematic review"],
    [INTENTS.tensionType, "Clinical practice guideline for cervicogenic headache and tension-type headache: chiropractic and exercise management"],
    [INTENTS.cervicogenic, "Exercise and manual therapy for cervicogenic headache: a systematic review"],
    [{ condition: "knee osteoarthritis", intervention: "exercise", question_type: "treatment" }, "Exercise for knee osteoarthritis: a systematic review"],
    [{ condition: "patellar tendinopathy", intervention: "exercise", question_type: "treatment" }, "Dutch multidisciplinary guideline on anterior knee pain: patellofemoral pain and patellar tendinopathy exercise"],
  ];
  for (const [rawIntent, title] of cases) {
    const intent = normalizeClinicalQuestion(rawIntent);
    const match = scoreClinicalMatch(article(title, "6001"), intent, { mode: "chat" });
    assert.equal(match.condition_relation, "exact", title);
    assert.equal(match.tier, "direct", title);
  }
});

test("relationships are generic: vocabulary decides, not per-condition code", () => {
  const rel = (title, raw) => conditionRelationship({ title }, normalizeClinicalQuestion(raw)).relation;
  assert.equal(rel("Whiplash exercise trial", { condition: "neck pain" }), "child");
  assert.equal(rel("Neck pain exercise trial", { condition: "whiplash" }), "parent");
  assert.equal(rel("Whiplash exercise trial", { condition: "cervical radiculopathy" }), "sibling");
  assert.equal(rel("Sciatica exercise trial", { condition: "low back pain" }), "related");
  assert.equal(rel("Neck pain guideline", { condition: "cervicogenic headache" }), "related");
  assert.equal(rel("Adolescent scoliosis exercise", { condition: "adolescent idiopathic scoliosis" }), "unknown");
  assert.equal(classifyConditionTerm("headache", normalizeClinicalQuestion({ condition: "migraine" })), "parent");
});
