const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isBroadKneeQuestion,
  buildFollowUpOptions,
  applyChatContinuationGuidance,
} = require("../src/services/chatContinuationGuidance");

test("detects undifferentiated knee pain but not a named diagnosis", () => {
  assert.equal(
    isBroadKneeQuestion(
      "Tengo un paciente adulto con dolor de rodilla, ¿qué debería evaluar y tratar?",
      {}
    ),
    true
  );
  assert.equal(
    isBroadKneeQuestion("Tratamiento para dolor patelofemoral", {}),
    false
  );
});

test("builds editable quick replies for knee follow-up", () => {
  const options = buildFollowUpOptions("dolor de rodilla", {}, "es");

  assert.equal(options.length, 4);
  assert.match(options[0].label, /Dolor y localización/);
  assert.match(options[0].prompt, /___/);
  assert.match(options[3].label, /Inseguridad/);
});

test("broad knee queries do not inherit a patellofemoral diagnosis", () => {
  const result = applyChatContinuationGuidance({
    structured: {
      brief_answer: [
        {
          text: "El paciente presenta dolor patelofemoral.",
          source_indices: [1],
        },
      ],
      clinical_application: [],
      assessment_considerations: [],
      precautions: [],
      confidence: { score: 88, level: "Alto", level_key: "high" },
    },
    question: "Tengo un paciente con dolor de rodilla",
    intent: { body_region: "rodilla" },
    articles: [{ title: "Patellofemoral guideline" }, { title: "Knee review" }],
    language: "es",
  });

  assert.doesNotMatch(result.brief_answer[0].text, /patelofemoral/i);
  assert.match(result.brief_answer[0].text, /no corresponde a un único diagnóstico/i);
  assert.equal(result.confidence.score, 72);
  assert.equal(result.follow_up_options.length, 4);
});
