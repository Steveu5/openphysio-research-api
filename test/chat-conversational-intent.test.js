const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildConversationalChatResponse,
  detectConversationalIntent,
  normalizeConversationalText,
} = require("../src/services/chatConversationalIntent");

test("normalizes punctuation, casing and Spanish accents", () => {
  assert.equal(normalizeConversationalText("  ¡HOLA!, ¿Cómo estás?  "), "hola como estas");
});

test("recognizes common Spanish and English social messages", () => {
  assert.deepEqual(detectConversationalIntent("hola como estas"), {
    type: "greeting",
    language: "es",
  });
  assert.deepEqual(detectConversationalIntent("Hola, buenos días"), {
    type: "greeting",
    language: "es",
  });
  assert.deepEqual(detectConversationalIntent("Thank you very much!"), {
    type: "thanks",
    language: "en",
  });
  assert.deepEqual(detectConversationalIntent("¿Quién eres?"), {
    type: "capabilities",
    language: "es",
  });
  assert.deepEqual(detectConversationalIntent("Hasta luego"), {
    type: "farewell",
    language: "es",
  });
});

test("does not intercept a greeting that contains a clinical question", () => {
  const clinicalMessages = [
    "Hola, tengo un paciente con dolor lumbar",
    "Buenos días, ¿qué evidencia hay para ejercicio en tendinopatía aquílea?",
    "Hello, what is the best exercise dosage for knee osteoarthritis?",
    "Gracias, tengo otra pregunta sobre dolor cervical",
    "¿Qué tal el ejercicio excéntrico para el tendón de Aquiles?",
  ];

  for (const message of clinicalMessages) {
    assert.equal(detectConversationalIntent(message), null, message);
  }
});

test("returns a source-free greeting with physiotherapy suggestions", () => {
  const response = buildConversationalChatResponse("Hola, ¿cómo estás?");

  assert.match(response.reply, /asistente clínico de OpenPhysioAI/i);
  assert.match(response.reply, /fisioterapia/i);
  assert.equal(response.responseMode, "conversational");
  assert.equal(response.citationStyle, "none");
  assert.deepEqual(response.sources, []);
  assert.equal(response.evidence_count, 0);
  assert.equal(response.retrieved_evidence_count, 0);
  assert.doesNotMatch(response.reply, /\[\d+\]/);
  assert.equal(response.followUpOptions.length, 3);
  assert.equal(
    response.followUpOptions.every((option) => /\?$/.test(option.prompt)),
    true
  );
});

test("does not show clinical suggestions after thanks or a farewell", () => {
  assert.deepEqual(
    buildConversationalChatResponse("Muchas gracias").followUpOptions,
    []
  );
  assert.deepEqual(
    buildConversationalChatResponse("Goodbye").followUpOptions,
    []
  );
});

test("returns null for empty, ambiguous or substantive content", () => {
  assert.equal(buildConversationalChatResponse(""), null);
  assert.equal(buildConversationalChatResponse("sí"), null);
  assert.equal(buildConversationalChatResponse("neurodinamia"), null);
});
