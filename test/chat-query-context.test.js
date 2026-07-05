const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isLikelyFollowUp,
  buildContextualEvidenceQuery,
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
  assert.match(query, /Follow-up question:/);
});

test("recognizes common Spanish and English follow-up forms", () => {
  assert.equal(isLikelyFollowUp("¿Y si es deportista?"), true);
  assert.equal(isLikelyFollowUp("What about older adults?"), true);
  assert.equal(
    isLikelyFollowUp(
      "Compare exercise therapy with education for chronic low back pain in adults"
    ),
    false
  );
});
