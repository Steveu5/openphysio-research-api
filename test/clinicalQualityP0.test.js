const test = require("node:test");
const assert = require("node:assert/strict");

const { rankByClinicalMatch, scoreClinicalMatch } = require("../src/services/clinicalMatch");
const { normalizeClinicalQuestion, detectQuestionType } = require("../src/services/clinicalQuestion");
const { assessEvidenceConfidence } = require("../src/services/evidenceConfidence");
const { assessComparison, buildComparisonQuery } = require("../src/services/comparisonEvidence");
const { collapseEquivalentEvidence } = require("../src/services/evidenceDedupe");
const { screenRedFlags, applySafetyToStructure, mergeModelSafetyConcern } = require("../src/services/clinicalSafety");
const {
  assessEvidenceSufficiency,
  buildInsufficientEvidenceStructure,
  INSUFFICIENT_STATEMENT,
} = require("../src/services/evidenceSufficiency");

const tendonIntent = normalizeClinicalQuestion({
  condition: "patellar tendinopathy",
  intervention: "exercise",
  condition_terms: ["jumper's knee"],
  question_type: "treatment",
});

const pfpGuide = {
  id: "library:pfp",
  title: "Patellofemoral Pain",
  study_type: "clinical practice guideline",
  evidence_level_rank: 10,
  year: 2019,
  abstract: "Guideline on knee pain, exercise and hip and knee strengthening.",
  library_resource: { slug: "patellofemoral-pain" },
};

test("a guide for another condition in the same region is tangential, not first", () => {
  const ranked = rankByClinicalMatch(
    [
      pfpGuide,
      { title: "Exercise for osteoarthritis of the knee", study_type: "systematic review", evidence_level_rank: 9, year: 2015 },
      { title: "Exercise for patellar tendinopathy", study_type: "systematic review", evidence_level_rank: 9, year: 2019 },
    ],
    tendonIntent,
    { mode: "chat" }
  );

  assert.equal(ranked[0].title, "Exercise for patellar tendinopathy");
  const guide = ranked.find((article) => article.id === "library:pfp");
  assert.equal(guide.clinical_match.tier, "tangential");
  assert.equal(guide.clinical_match.competing_condition, true);
  assert.ok(guide.clinical_match.reasons.includes("title addresses a different condition"));
});

test("a direct trial outranks a tangential systematic review in both modes", () => {
  const articles = [
    { title: "Exercise therapy for knee osteoarthritis: a systematic review", study_type: "systematic review", evidence_level_rank: 9, year: 2024 },
    { title: "Isometric exercise in jumper's knee: a randomized trial", study_type: "randomized controlled trial", evidence_level_rank: 7, year: 2016 },
  ];
  for (const mode of ["chat", "research"]) {
    const ranked = rankByClinicalMatch(articles, tendonIntent, { mode });
    assert.match(ranked[0].title, /jumper's knee/, mode);
    assert.equal(ranked[0].clinical_match.tier, "direct");
    assert.equal(ranked[0].clinical_match.position, 1);
  }
});

test("studies about a guideline are not scored as the guideline", () => {
  const match = scoreClinicalMatch(
    { title: "Barriers to the use of a patellar tendinopathy clinical practice guideline", study_type: "clinical practice guideline", evidence_level_rank: 10 },
    tendonIntent
  );
  assert.ok(match.components.design <= 0.3);
  assert.ok(match.reasons.includes("about a guideline, not the guideline itself"));
});

test("question types and comparators are parsed without inventing data", () => {
  assert.equal(detectQuestionType("¿Es mejor el ejercicio excéntrico o el isométrico?"), "comparison");
  assert.equal(detectQuestionType("Diagnostic accuracy of clinical tests for ACL rupture"), "diagnosis");
  assert.equal(detectQuestionType("¿Cuál es el pronóstico del dolor lumbar agudo?"), "prognosis");
  assert.equal(detectQuestionType("Return to play criteria after hamstring strain"), "return_to_sport");
  assert.equal(detectQuestionType("¿Qué dosis de ejercicio de fuerza?"), "progression");

  const split = normalizeClinicalQuestion({ intervention: "heavy slow resistance versus eccentric training", population: "unknown", outcome: "" });
  assert.equal(split.intervention, "heavy slow resistance");
  assert.equal(split.comparator, "eccentric training");
  assert.equal(split.question_type, "comparison");
  assert.equal(split.population, null);
  assert.equal(split.outcome, null);

  const followUp = normalizeClinicalQuestion(
    { condition: "Achilles tendinopathy" },
    "Clinical conversation context (earlier user messages):\n- ¿Es mejor A o B?\nLatest question: ¿Qué dosis usarías?"
  );
  assert.equal(followUp.question_type, "progression");
});

const comparisonIntent = normalizeClinicalQuestion({
  condition: "Achilles tendinopathy",
  intervention: "heavy slow resistance",
  comparator: "eccentric training",
  question_type: "comparison",
});

test("comparisons detect head-to-head studies and state when there are none", () => {
  const ranked = rankByClinicalMatch(
    [
      { title: "Eccentric training for Achilles tendinopathy: systematic review", study_type: "systematic review", evidence_level_rank: 9, year: 2021 },
      { title: "Heavy slow resistance versus eccentric training for Achilles tendinopathy: randomized trial", study_type: "randomized controlled trial", evidence_level_rank: 7, year: 2015 },
    ],
    comparisonIntent,
    { mode: "research" }
  );
  assert.equal(ranked[0].clinical_match.direct_comparison, true);
  assert.equal(assessComparison(ranked, comparisonIntent, "es").direct, true);

  const none = assessComparison(ranked.slice(1), comparisonIntent, "es");
  assert.equal(none.direct, false);
  assert.match(none.statement, /No se encontraron comparaciones directas suficientes/);
  assert.match(buildComparisonQuery(comparisonIntent), /"heavy slow resistance".* AND .*"eccentric training".* AND .*"Achilles tendinopathy"/);
});

function tiered(tier, rank = 9, extra = {}) {
  return { title: `${tier} source`, abstract: "text", evidence_level_rank: rank, clinical_match: { tier, components: { design: rank / 10 } }, ...extra };
}

test("confidence is never high with indirect, tangential or comparison-without-direct evidence", () => {
  const intent = { condition: "x", question_type: "treatment" };
  const high = assessEvidenceConfidence([tiered("direct"), tiered("direct"), tiered("direct"), tiered("direct", 7)], { intent });
  assert.equal(high.level_key, "high");

  const indirect = assessEvidenceConfidence([tiered("partial"), tiered("partial"), tiered("partial")], { intent });
  assert.equal(indirect.level_key, "indirect");

  const tangentialFirst = assessEvidenceConfidence([tiered("tangential", 10), tiered("direct"), tiered("direct"), tiered("direct")], { intent });
  assert.equal(tangentialFirst.level_key, "indirect");

  const comparison = assessEvidenceConfidence([tiered("direct"), tiered("direct"), tiered("direct")], {
    intent,
    comparison: { requested: true, direct: false },
  });
  assert.equal(comparison.level_key, "indirect");

  const conflicting = assessEvidenceConfidence([tiered("direct"), tiered("direct"), tiered("direct")], { intent, consistency: "low" });
  assert.equal(conflicting.level_key, "conflicting");

  const underspecified = assessEvidenceConfidence([tiered("direct"), tiered("direct"), tiered("direct")], {
    intent: { condition: null, question_type: "treatment" },
  });
  assert.notEqual(underspecified.level_key, "high");
  for (const result of [indirect, tangentialFirst, comparison, conflicting, underspecified]) {
    assert.ok(result.score < 75);
  }
});

test("dedupe merges DOI/PMID/title equivalents and guideline versions, not distinct guidelines", () => {
  const { articles, collapsed } = collapseEquivalentEvidence([
    { title: "Neck Pain: Revision 2017", year: 2017, study_type: "clinical practice guideline", library_resource: { slug: "neck" } },
    { title: "Neck pain: clinical practice guidelines linked to the International Classification of Functioning, Disability, and Health", year: 2008, study_type: "clinical practice guideline", pmid: "18758050" },
    { title: "Hip Pain and Mobility Deficits—Hip Osteoarthritis: Revision 2017", year: 2017, study_type: "clinical practice guideline" },
    { title: "Hip Pain and Movement Dysfunction Associated With Nonarthritic Hip Joint Pain", year: 2023, study_type: "clinical practice guideline" },
    { title: "Exercise for patellar tendinopathy", doi: "10.1000/ABC" },
    { title: "Exercise for patellar tendinopathy.", doi: "https://doi.org/10.1000/abc" },
  ]);

  assert.equal(collapsed, 2);
  assert.equal(articles.length, 4);
  assert.equal(articles[0].library_resource.slug, "neck");
  assert.equal(articles[0].pmid, "18758050");
  assert.equal(articles[0].superseded_versions[0].reason, "guideline_version");
});

test("a newer external revision replaces an older Library version", () => {
  const { articles } = collapseEquivalentEvidence([
    { title: "Neck Pain: Revision 2017", year: 2017, study_type: "clinical practice guideline", library_resource: { slug: "neck" } },
    { title: "Neck Pain: Revision 2026", year: 2026, study_type: "clinical practice guideline" },
  ]);
  assert.equal(articles.length, 1);
  assert.equal(articles[0].year, 2026);
});

test("red flags trigger the safety route and benign questions do not", () => {
  const redFlags = [
    ["Lumbalgia con anestesia en silla de montar y retención urinaria", "neurological_compromise", "emergency"],
    ["68 años, antecedente de cáncer de próstata, dolor nocturno y pérdida de peso", "suspected_malignancy", "prompt"],
    ["Tras artroplastia de rodilla: dolor en la pantorrilla con hinchazón y calor", "vascular_thrombotic", "emergency"],
    ["Neck pain with dizziness and diplopia after manipulation", "cervical_arterial_or_neurovascular", "emergency"],
    ["Low back pain with fever in an immunosuppressed patient", "suspected_infection", "urgent"],
  ];
  for (const [question, category, urgency] of redFlags) {
    const screen = screenRedFlags({ question });
    assert.equal(screen.status, "red_flag", question);
    assert.ok(screen.categories.includes(category), question);
    assert.equal(screen.urgency, urgency, question);
  }

  const benign = [
    "¿Qué ejercicios recomienda la evidencia para la tendinopatía rotuliana?",
    "Ejercicio aeróbico en pacientes con EPOC y disnea de esfuerzo",
    "Dolor torácico mecánico en remero: ¿movilización torácica?",
    "Hinchazón de rodilla 3 semanas después de artroplastia, ¿cómo progreso la flexión?",
    "Antecedentes de esguince de tobillo recurrente, ¿qué ejercicios?",
  ];
  for (const question of benign) {
    assert.equal(screenRedFlags({ question }).status, "none", question);
  }

  const fromContext = screenRedFlags({
    question: "¿Qué ejercicios le doy?",
    messages: [{ role: "user", content: "Paciente con retención urinaria y anestesia en silla de montar" }],
  });
  assert.equal(fromContext.status, "red_flag");
});

test("safety goes first in the answer; the model can raise a softer concern", () => {
  const screen = screenRedFlags({ question: "anestesia en silla de montar" });
  const structured = applySafetyToStructure({ brief_answer: [{ text: "Ejercicio.", source_indices: [1] }] }, screen, "es");
  assert.match(structured.brief_answer[0].text, /^Prioridad de seguridad/);
  assert.match(structured.brief_answer[0].text, /urgencias/);
  assert.equal(structured.safety.status, "red_flag");

  const possible = mergeModelSafetyConcern(screenRedFlags({ question: "dolor de hombro" }), { present: true, reason: "dolor visceral referido" });
  assert.equal(possible.status, "possible_red_flag");
  assert.equal(applySafetyToStructure({ brief_answer: [] }, { status: "none" }, "es").brief_answer.length, 0);
});

test("insufficient evidence returns the explicit statement instead of a synthesis", () => {
  const tangentialOnly = [{ title: "A", clinical_match: { tier: "tangential" } }];
  assert.equal(assessEvidenceSufficiency(tangentialOnly).status, "insufficient");
  assert.equal(assessEvidenceSufficiency([]).status, "insufficient");
  assert.equal(assessEvidenceSufficiency([{ clinical_match: { tier: "partial" } }]).status, "limited");
  assert.equal(assessEvidenceSufficiency([{ clinical_match: { tier: "direct" } }]).status, "sufficient");

  const structured = buildInsufficientEvidenceStructure(tangentialOnly, "es");
  assert.equal(structured.brief_answer[0].text, INSUFFICIENT_STATEMENT.es);
  assert.equal(structured.clinical_application.length, 0);
  assert.equal(structured.confidence.level_key, "limited");
});

test("without condition or intervention, the query topic anchors the match", () => {
  const intent = normalizeClinicalQuestion({
    normalized_query: "lateral knee pain in runners: assessment and treatment approach",
    population: "runners",
    question_type: "treatment",
  });
  const ranked = rankByClinicalMatch(
    [
      { title: "Efficacy of high-intensity laser therapy for patellofemoral pain: a systematic review", evidence_level_rank: 9, year: 2026 },
      { title: "Lateral knee pain in runners: iliotibial band syndrome management", evidence_level_rank: 7, year: 2020 },
    ],
    intent,
    { mode: "chat" }
  );
  assert.match(ranked[0].title, /Lateral knee pain/);
  assert.equal(ranked[0].clinical_match.anchor, "query_topic");
  assert.equal(ranked[1].clinical_match.tier, "tangential");
});

test("with no condition, an intervention mentioned only in the abstract is not direct", () => {
  const intent = normalizeClinicalQuestion({ intervention: "mobilization", question_type: "treatment" });
  const match = scoreClinicalMatch(
    { title: "Noninvasive management of soft tissue disorders of the shoulder", abstract: "Mobilization and exercise were reviewed.", evidence_level_rank: 10 },
    intent
  );
  assert.equal(match.tier, "partial");
});

test("common abstract words do not make a study fit a diagnosis question", () => {
  const intent = normalizeClinicalQuestion({ condition: "subacromial pain syndrome", question_type: "diagnosis" });
  const exercise = scoreClinicalMatch(
    { title: "Exercise therapy for subacromial pain syndrome", abstract: "Patients diagnosed with subacromial pain syndrome were followed up.", evidence_level_rank: 9 },
    intent
  );
  const accuracy = scoreClinicalMatch(
    { title: "Diagnostic accuracy of clinical tests for subacromial pain syndrome", evidence_level_rank: 8 },
    intent
  );
  assert.equal(exercise.tier, "partial");
  assert.equal(accuracy.tier, "direct");
});

test("a letter about an article collapses into the article", () => {
  const { articles } = collapseEquivalentEvidence([
    { title: "RE: Reinterpreting the Clinical Practice Guidelines for Plantar Heel Pain", year: 2025 },
    { title: "Reinterpreting the Clinical Practice Guidelines for Plantar Heel Pain", year: 2024 },
  ]);
  assert.equal(articles.length, 1);
  assert.doesNotMatch(articles[0].title, /^RE:/);
});

test("the patellofemoral template never replaces an answer about a specific intervention", () => {
  const { applyChatContinuationGuidance } = require("../src/services/chatContinuationGuidance");
  const structured = { brief_answer: [{ text: "Hip strengthening reduces pain.", source_indices: [1] }], confidence: {} };
  const result = applyChatContinuationGuidance({
    structured,
    question: "¿Es eficaz el fortalecimiento de cadera en el dolor patelofemoral?",
    intent: { condition: "patellofemoral pain", intervention: "hip strengthening" },
    articles: [],
    language: "es",
  });
  assert.equal(result.brief_answer[0].text, "Hip strengthening reduces pain.");
});

test("a diagnostic review titled 'diagnosing' fits a diagnosis question even without abstract", () => {
  const intent = normalizeClinicalQuestion({ condition: "anterior cruciate ligament rupture", question_type: "diagnosis" });
  const ranked = rankByClinicalMatch(
    [
      { title: "Hypertrophic mucoid degeneration of the anterior cruciate ligament mimicking a tear: a case report", year: 2026 },
      { title: "Physical tests for diagnosing anterior cruciate ligament rupture", study_type: "systematic review", evidence_level_rank: 9, year: 2018 },
    ],
    intent,
    { mode: "chat" }
  );
  assert.match(ranked[0].title, /Physical tests for diagnosing/);
  assert.equal(ranked[0].clinical_match.tier, "direct");
});

test("sources sharing most of the query topic are usable but not direct", () => {
  const intent = normalizeClinicalQuestion({
    normalized_query: "lateral knee pain in runners: assessment and treatment approach",
    question_type: "treatment",
  });
  const match = scoreClinicalMatch({ title: "Common risk factors for knee injuries in runners: a systematic review", evidence_level_rank: 9 }, intent);
  assert.equal(match.tier, "partial");
});
