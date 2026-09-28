const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildContextualEvidenceQuery,
  hasConversationContext,
} = require("../src/services/chatQueryContext");

test("keeps a complete clinical question unchanged", () => {
  const question =
    "What is the evidence for therapeutic exercise in chronic low back pain?";

  assert.equal(
    buildContextualEvidenceQuery({ question, messages: [] }),
    question
  );
});

test("adds recent user context to a short follow-up question", () => {
  const query = buildContextualEvidenceQuery({
    question: "¿Y si tiene 70 años?",
    messages: [
      {
        role: "user",
        content: "¿Qué ejercicio funciona mejor para dolor lumbar crónico?",
      },
      {
        role: "assistant",
        content: "La evidencia apoya diferentes modalidades progresivas.",
      },
      { role: "user", content: "¿Y si tiene 70 años?" },
    ],
  });

  assert.match(query, /dolor lumbar crónico/i);
  assert.match(query, /70 años/i);
  assert.match(query, /Latest question:/);
  assert.equal(hasConversationContext(query), true);
});

test("passes context for long follow-ups without \"¿\" or follow-up keywords", () => {
  const query = buildContextualEvidenceQuery({
    question:
      "Qué ejercicios específicos tendrían más sentido en este caso particular para empezar",
    messages: [
      { role: "user", content: "Oficinista de 40 años con dolor cervical mecánico de 6 semanas." },
      { role: "assistant", content: "La evidencia apoya ejercicio y educación." },
    ],
  });

  assert.match(query, /dolor cervical mecánico/);
  assert.match(query, /Latest question: Qué ejercicios específicos/);
});

test("never copies earlier AI output into the search context", () => {
  const query = buildContextualEvidenceQuery({
    question: "¿Y cómo progresarías la carga?",
    messages: [
      { role: "user", content: "Tendinopatía aquílea de 3 meses en corredor." },
      { role: "assistant", content: "Heavy slow resistance con 3x15 repeticiones." },
    ],
  });

  assert.match(query, /aquílea/);
  assert.doesNotMatch(query, /Heavy slow resistance/);
});

test("does not duplicate the latest question when the client includes it", () => {
  const query = buildContextualEvidenceQuery({
    question: "¿Y en cadera?",
    messages: [
      { role: "user", content: "Ejercicio en artrosis de rodilla" },
      { role: "user", content: "¿Y en cadera?" },
    ],
  });

  assert.equal(query.match(/¿Y en cadera\?/g).length, 1);
});
