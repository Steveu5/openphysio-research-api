const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isBroadKneeQuestion,
  isLikelyPatellofemoralPattern,
  hasClinicalSpecificitySignals,
  applyChatContinuationGuidance,
} = require("../src/services/chatContinuationGuidance");

const patellofemoralArticles = [
  {
    title: "Patellofemoral Pain",
    study_type: "Clinical practice guideline",
    evidence_level: "Guideline",
  },
  {
    title: "Dutch multidisciplinary guideline on anterior knee pain: Patellofemoral pain and patellar tendinopathy",
    study_type: "Clinical practice guideline",
  },
];

test("specific anterior knee pain patterns are not treated as broad knee pain", () => {
  const question =
    "Paciente adulto con dolor anterior de rodilla al subir escaleras y sentadillas, ¿qué debería evaluar y tratar?";

  assert.equal(isLikelyPatellofemoralPattern(question, {}, patellofemoralArticles), true);
  assert.equal(hasClinicalSpecificitySignals(question, {}, patellofemoralArticles), true);
  assert.equal(isBroadKneeQuestion(question, {}, patellofemoralArticles), false);
});

test("generic knee pain remains protected as undifferentiated", () => {
  const question =
    "Tengo un paciente adulto con dolor de rodilla, ¿qué debería evaluar y tratar según la evidencia?";

  assert.equal(isLikelyPatellofemoralPattern(question, {}, patellofemoralArticles), false);
  assert.equal(isBroadKneeQuestion(question, {}, patellofemoralArticles), true);
});

test("patellofemoral pattern receives condition-specific structure and follow-ups", () => {
  const response = applyChatContinuationGuidance({
    structured: {
      confidence: { level: "Alto", score: 88, rationale: "base" },
    },
    question:
      "Paciente adulto con dolor anterior de rodilla al subir escaleras y sentadillas, ¿qué debería evaluar y tratar?",
    intent: {},
    articles: patellofemoralArticles,
    language: "es",
  });

  const answerText = response.brief_answer.map((item) => item.text).join(" ");
  const followUpText = response.follow_up_options.map((item) => item.prompt).join(" ");

  assert.match(answerText, /compatible con un patrón de dolor patelofemoral/i);
  assert.match(followUpText, /fuerza de cadera/i);
  assert.match(response.confidence.level, /Moderado-alto/);
});

test("specificity signals work beyond knee-only cases", () => {
  const question =
    "Paciente con dolor lateral de hombro al elevar el brazo por encima de la cabeza y debilidad, ¿cómo lo evalúo?";

  assert.equal(hasClinicalSpecificitySignals(question, {}, []), true);
});
