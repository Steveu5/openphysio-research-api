const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_QUERY_LENGTH,
  MAX_MESSAGES,
  validateResearchRequest,
  validateChatRequest,
} = require("../src/services/requestValidation");

test("Research requires a non-empty bounded text query", () => {
  assert.throws(
    () => validateResearchRequest({ query: "   " }),
    (error) => error.status === 400 && error.code === "INVALID_QUERY"
  );
  assert.throws(
    () => validateResearchRequest({ query: "x".repeat(MAX_QUERY_LENGTH + 1) }),
    (error) => error.code === "QUERY_TOO_LONG"
  );

  assert.deepEqual(validateResearchRequest({ query: "  dolor lumbar  " }), {
    query: "dolor lumbar",
    sessionId: null,
    filters: {},
  });
});

test("Chat bounds messages, filters, and result limits", () => {
  assert.throws(
    () =>
      validateChatRequest({
        question: "dolor cervical",
        messages: Array.from({ length: MAX_MESSAGES + 1 }, () => ({
          role: "user",
          content: "mensaje",
        })),
      }),
    (error) => error.code === "INVALID_MESSAGES"
  );
  assert.throws(
    () => validateChatRequest({ question: "dolor cervical", filters: [] }),
    (error) => error.code === "INVALID_FILTERS"
  );
  assert.throws(
    () => validateChatRequest({ question: "dolor cervical", limit: 21 }),
    (error) => error.code === "INVALID_LIMIT"
  );

  const request = validateChatRequest({
    chatInput: "  dolor cervical  ",
    messages: [{ role: "user", text: "  contexto previo  " }],
  });
  assert.equal(request.question, "dolor cervical");
  assert.equal(request.messages[0].content, "contexto previo");
  assert.equal(request.limit, 8);
});
