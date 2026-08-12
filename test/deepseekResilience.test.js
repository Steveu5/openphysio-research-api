const test = require("node:test");
const assert = require("node:assert/strict");

const {
  callDeepSeek,
  deepSeekTimeoutMs,
} = require("../src/services/deepseek");

test("DeepSeek timeout configuration rejects invalid values", () => {
  assert.equal(deepSeekTimeoutMs({ timeoutMs: 25 }), 25);
  assert.ok(deepSeekTimeoutMs({ timeoutMs: -1 }) > 0);
});

test("DeepSeek aborts a stalled request with a public retryable code", async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test-key";

  global.fetch = (_url, options = {}) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });

  try {
    await assert.rejects(
      () => callDeepSeek([{ role: "user", content: "test" }], { timeoutMs: 5 }),
      (error) =>
        error.status === 504 &&
        error.code === "AI_PROVIDER_TIMEOUT" &&
        error.expose === true
    );
  } finally {
    global.fetch = originalFetch;
    if (originalKey == null) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});
