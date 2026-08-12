const test = require("node:test");
const assert = require("node:assert/strict");

const {
  publicErrorResponse,
} = require("../src/services/publicError");

test("internal errors do not expose messages or details", () => {
  const response = publicErrorResponse({
    message: "service role key rejected by upstream",
    details: "secret diagnostic payload",
  });

  assert.equal(response.status, 500);
  assert.deepEqual(response.payload, {
    error: "Internal server error",
    code: "INTERNAL_SERVER_ERROR",
  });
  assert.doesNotMatch(JSON.stringify(response.payload), /service role|secret/i);
});

test("explicit public provider errors keep only their safe message and code", () => {
  const response = publicErrorResponse({
    status: 504,
    message: "The evidence synthesis took too long",
    code: "AI_PROVIDER_TIMEOUT",
    details: "upstream trace",
    expose: true,
  });

  assert.deepEqual(response.payload, {
    error: "The evidence synthesis took too long",
    code: "AI_PROVIDER_TIMEOUT",
  });
  assert.doesNotMatch(JSON.stringify(response.payload), /upstream trace/i);
});
