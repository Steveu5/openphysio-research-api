const test = require("node:test");
const assert = require("node:assert/strict");
const { buildGapFollowUps, MAX_FOLLOW_UPS } = require("../src/services/chatFollowUps");

const gaps = (args) => buildGapFollowUps(args).map((f) => f.gap);
const answer = (text) => ({ brief_answer: [{ text }], clinical_application: [] });

test("no head-to-head comparison: offer each option's evidence separately", () => {
  const result = buildGapFollowUps({
    intent: { question_type: "comparison", condition: "x" },
    comparison: { requested: true, direct: false },
    structured: answer("No hay comparaciones directas."),
  });
  assert.equal(result[0].gap, "separate");
  assert.match(result[0].prompt, /compare por separado la evidencia/);
});

test("missing dosage is offered only when the answer has no dose information", () => {
  assert.ok(gaps({ intent: { question_type: "treatment", condition: "x" }, structured: answer("El ejercicio ayuda.") }).includes("dose"));
  assert.ok(!gaps({ intent: { question_type: "treatment", condition: "x" }, structured: answer("3 series de 15 repeticiones, 12 semanas.") }).includes("dose"));
});

test("diagnostic uncertainty and question-specific gaps", () => {
  assert.ok(gaps({ question: "Dolor lateral de rodilla al correr, ¿qué hago?", intent: { question_type: "treatment", condition: null }, structured: answer("…") }).includes("differentiate"));
  assert.deepEqual(gaps({ intent: { question_type: "diagnosis", condition: "acl rupture" }, structured: answer("Lachman") }), ["accuracy"]);
  assert.deepEqual(gaps({ intent: { question_type: "prognosis", condition: "lbp" }, structured: answer("…") }), ["prognosis"]);
  assert.deepEqual(gaps({ intent: { question_type: "return_to_sport", condition: "acl" }, structured: answer("…") }), ["rts"]);
});

test("indirect or limited evidence offers to broaden the search", () => {
  const result = gaps({ intent: { question_type: "progression", condition: "x" }, confidence: { level_key: "indirect" }, structured: answer("…") });
  assert.deepEqual(result, ["progression", "broaden"]);
});

test("red flags: only a referral-oriented follow-up", () => {
  assert.deepEqual(gaps({ intent: { question_type: "treatment" }, safety: { status: "red_flag" }, structured: answer("…") }), ["referral"]);
});

test("at most three, no generic template options, and English is native", () => {
  const result = buildGapFollowUps({
    intent: { question_type: "comparison", condition: null },
    comparison: { requested: true, direct: false },
    confidence: { level_key: "indirect" },
    structured: answer("…"),
    language: "en",
  });
  assert.equal(result.length, MAX_FOLLOW_UPS);
  for (const option of result) {
    assert.doesNotMatch(option.prompt, /¿|Completar la evaluación|Construir un plan/);
    assert.ok(option.label && option.prompt.endsWith("?"));
  }
});

test("Chat replaces the generic continuation options with the gap-based ones", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const chat = fs.readFileSync(path.join(__dirname, "../src/routes/chat.js"), "utf8");
  assert.match(chat, /follow_up_options: followUps/);
  assert.match(chat, /follow_up_question: followUps\[0\]\?\.prompt \|\| null/);
});
