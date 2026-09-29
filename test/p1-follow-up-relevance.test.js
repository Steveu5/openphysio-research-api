const test = require("node:test");
const assert = require("node:assert/strict");
const { buildGapFollowUps, MAX_FOLLOW_UPS } = require("../src/services/chatFollowUps");

const gaps = (args) => buildGapFollowUps(args).map((f) => f.gap);
const answer = (text = "La evidencia es limitada.") => ({ brief_answer: [{ text }], clinical_application: [] });

test("A. performance / prevention questions without symptoms never get a differential-diagnosis follow-up", () => {
  const questions = [
    "¿Mejora el entrenamiento pliométrico el sprint en futbolistas juveniles?",
    "Does a warm-up programme prevent injuries in amateur runners?",
    "¿Qué efecto tiene el estiramiento estático sobre la fuerza en adultos sanos?",
  ];
  for (const question of questions) {
    for (const type of ["treatment", "general", "comparison"]) {
      assert.ok(!gaps({ question, intent: { question_type: type, condition: null }, structured: answer() }).includes("differentiate"), `${type}: ${question}`);
    }
  }
});

test("B. insufficient evidence: no dosage or progression follow-up; broaden instead", () => {
  for (const type of ["treatment", "general", "comparison", "progression"]) {
    const result = gaps({
      question: "¿Mejora la técnica X el rendimiento en salto en deportistas?",
      intent: { question_type: type, condition: null },
      sufficiency: { status: "insufficient" },
      confidence: { level_key: "limited" },
      structured: answer(),
    });
    assert.ok(!result.includes("dose"), type);
    assert.ok(!result.includes("progression"), type);
    assert.ok(result.includes("broaden"), type);
  }
});

test("C. described symptoms without an identified condition can get a differential follow-up", () => {
  for (const question of ["Dolor lateral de rodilla al correr, ¿qué hago?", "Shoulder pain and weakness when lifting the arm: where to start?", "Hormigueo en la mano por la noche, ¿qué ejercicios?"]) {
    assert.ok(gaps({ question, intent: { question_type: "treatment", condition: null }, structured: answer() }).includes("differentiate"), question);
  }
  // With a diagnostic question and symptoms, too.
  assert.ok(gaps({ question: "¿Qué pruebas usar ante dolor e inestabilidad de rodilla?", intent: { question_type: "diagnosis", condition: null }, structured: answer() }).includes("differentiate"));
});

test("D. treatment question with sufficient evidence and no dose in the answer can get a dosage follow-up", () => {
  const result = gaps({
    question: "¿Qué ejercicios recomienda la evidencia para la tendinopatía rotuliana?",
    intent: { question_type: "treatment", condition: "patellar tendinopathy" },
    sufficiency: { status: "sufficient" },
    confidence: { level_key: "moderate" },
    structured: answer("El ejercicio de carga progresiva es la base del tratamiento."),
  });
  assert.deepEqual(result, ["dose"]);
});

test("E. comparison without head-to-head evidence suggests each option's evidence separately", () => {
  const result = gaps({
    question: "¿Es mejor A o B para la condición X?",
    intent: { question_type: "comparison", condition: "x", intervention: "A", comparator: "B" },
    comparison: { requested: true, direct: false },
    sufficiency: { status: "limited" },
    confidence: { level_key: "indirect" },
    structured: answer(),
  });
  assert.equal(result[0], "separate");
  assert.ok(!result.includes("differentiate"));
});

test("F. red flags keep the follow-ups on safety and referral only", () => {
  const result = gaps({
    question: "Dolor lumbar con anestesia en silla de montar, ¿qué ejercicios?",
    intent: { question_type: "treatment", condition: null },
    safety: { status: "red_flag" },
    sufficiency: { status: "insufficient" },
    structured: answer(),
  });
  assert.deepEqual(result, ["referral"]);
});

test("no padding: 0, 1 or 2 follow-ups when that is all that applies", () => {
  assert.deepEqual(gaps({ question: "¿Qué ejercicios para la artrosis de rodilla?", intent: { question_type: "treatment", condition: "knee osteoarthritis" }, sufficiency: { status: "sufficient" }, confidence: { level_key: "high" }, structured: answer("3 series de 10 repeticiones, 12 semanas.") }), []);
  assert.equal(gaps({ question: "Pronóstico del esguince de tobillo", intent: { question_type: "prognosis", condition: "ankle sprain" }, sufficiency: { status: "sufficient" }, confidence: { level_key: "moderate" }, structured: answer() }).length, 1);
  const withGaps = gaps({ question: "Dolor de hombro, ¿ejercicios?", intent: { question_type: "treatment", condition: null }, sufficiency: { status: "limited" }, confidence: { level_key: "indirect" }, structured: answer() });
  assert.ok(withGaps.length <= MAX_FOLLOW_UPS);
});

test("the Chat route passes the clinician's question to the follow-up builder", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const chat = fs.readFileSync(path.join(__dirname, "../src/routes/chat.js"), "utf8");
  assert.match(chat, /buildGapFollowUps\(\{\s*question: userQuestion,/);
});
