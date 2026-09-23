const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const {
  isPeakTime,
  normalizeUsage,
  estimateCostUsd,
  meterAiOperation,
  annotateAiOperation,
} = require("../src/services/aiUsage");
const {
  callDeepSeek,
  deepSeekModel,
  deepSeekThinking,
} = require("../src/services/deepseek");

function withDeepSeekStub(handler, fn) {
  const originalFetch = global.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  const originalLog = console.log;
  const logs = [];
  const requests = [];
  process.env.DEEPSEEK_API_KEY = "test-key";
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, body, headers: options.headers });
    return handler(body, requests.length);
  };
  console.log = (line) => {
    try {
      logs.push(JSON.parse(line));
    } catch {
      originalLog(line);
    }
  };
  return Promise.resolve()
    .then(() => fn({ logs, requests }))
    .finally(() => {
      global.fetch = originalFetch;
      console.log = originalLog;
      if (originalKey == null) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = originalKey;
    });
}

const okResponse = (usage, model = "deepseek-flash") => ({
  ok: true,
  json: async () => ({
    model,
    choices: [{ message: { content: "{\"ok\":true}" } }],
    usage,
  }),
});

function fakeRequestCycle(operation, handler) {
  const res = new EventEmitter();
  res.statusCode = 200;
  const middleware = meterAiOperation(operation);
  return new Promise((resolve, reject) => {
    middleware({}, res, () => {
      Promise.resolve()
        .then(() => handler(res))
        .then(() => {
          res.emit("finish");
          resolve(res);
        }, reject);
    });
  });
}

async function waitForLog(logs, type) {
  for (let i = 0; i < 200; i += 1) {
    const entry = logs.find((line) => line.type === type);
    if (entry) return entry;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`no ${type} log`);
}

test("model defaults to deepseek-flash, configurable by DEEPSEEK_MODEL; thinking disabled by default", () => {
  assert.equal(deepSeekModel({}), "deepseek-flash");
  assert.equal(deepSeekModel({ DEEPSEEK_MODEL: " deepseek-v4-pro " }), "deepseek-v4-pro");
  assert.equal(deepSeekThinking({}), "disabled");
  assert.equal(deepSeekThinking({ DEEPSEEK_THINKING: "enabled" }), "enabled");
  assert.equal(deepSeekThinking({ DEEPSEEK_THINKING: "weird" }), "disabled");
});

test("callDeepSeek sends deepseek-flash with thinking disabled, never deepseek-chat", async () => {
  await withDeepSeekStub(
    () => okResponse({ prompt_tokens: 10, completion_tokens: 5 }),
    async ({ requests }) => {
      await callDeepSeek([{ role: "user", content: "x" }], { json: true });
      assert.equal(requests[0].body.model, "deepseek-flash");
      assert.deepEqual(requests[0].body.thinking, { type: "disabled" });
      assert.deepEqual(requests[0].body.response_format, { type: "json_object" });
      assert.notEqual(requests[0].body.model, "deepseek-chat");
    }
  );
});

test("peak window follows DeepSeek's UTC schedule", () => {
  assert.equal(isPeakTime(new Date("2026-09-23T02:30:00Z")), true); // Wed
  assert.equal(isPeakTime(new Date("2026-09-23T07:00:00Z")), true);
  assert.equal(isPeakTime(new Date("2026-09-23T04:00:00Z")), false);
  assert.equal(isPeakTime(new Date("2026-09-23T15:00:00Z")), false);
  assert.equal(isPeakTime(new Date("2026-09-26T02:30:00Z")), false); // Sat
});

test("cost uses cache-hit, cache-miss and output prices of the official table", () => {
  const tokens = normalizeUsage({
    prompt_tokens: 1_000_000,
    prompt_cache_hit_tokens: 400_000,
    prompt_cache_miss_tokens: 600_000,
    completion_tokens: 1_000_000,
  });
  const offPeak = new Date("2026-09-23T15:00:00Z");
  const peak = new Date("2026-09-23T02:00:00Z");
  // 0.4*0.003 + 0.6*0.15 + 1*0.6
  assert.equal(estimateCostUsd("deepseek-flash", tokens, offPeak), 0.6912);
  assert.equal(estimateCostUsd("deepseek-flash", tokens, peak), 1.3824);
  assert.equal(estimateCostUsd("unknown-model", tokens, offPeak), null);
});

test("cache miss is derived when DeepSeek omits it", () => {
  const tokens = normalizeUsage({ prompt_tokens: 100, prompt_cache_hit_tokens: 30 });
  assert.equal(tokens.cacheMissTokens, 70);
});

test("one operation sums every internal call, including background calls that finish after the response", async () => {
  await withDeepSeekStub(
    (_body, n) =>
      n === 3
        ? new Promise((resolve) =>
            setTimeout(() => resolve(okResponse({ prompt_tokens: 50, completion_tokens: 20 })), 30)
          )
        : okResponse({ prompt_tokens: 1000, prompt_cache_hit_tokens: 200, completion_tokens: 300 }),
    async ({ logs }) => {
      await fakeRequestCycle("chat_question", async () => {
        annotateAiOperation({ cached: false });
        await callDeepSeek([{ role: "user", content: "secret clinical text" }], { purpose: "search_intent" });
        await callDeepSeek([{ role: "user", content: "secret clinical text" }], { purpose: "chat_answer" });
        callDeepSeek([{ role: "user", content: "abstract" }], { purpose: "article_takeaway" }).catch(() => {});
      });
      const op = await waitForLog(logs, "ai_operation");
      assert.equal(op.operation, "chat_question");
      assert.equal(op.calls, 3);
      assert.equal(op.failed_calls, 0);
      assert.equal(op.input_tokens, 2050);
      assert.equal(op.cache_hit_tokens, 400);
      assert.equal(op.output_tokens, 620);
      assert.deepEqual(op.calls_by_purpose, { search_intent: 1, chat_answer: 1, article_takeaway: 1 });
      assert.equal(op.counts_as_chat_quota_unit, true);
      assert.equal(op.cached_result, false);
      const callCostSum = logs
        .filter((line) => line.type === "ai_call")
        .reduce((sum, line) => sum + line.cost_usd, 0);
      assert.ok(Math.abs(op.cost_usd - callCostSum) < 1e-9);
      assert.ok(op.cost_usd > 0);
      assert.deepEqual(op.models, ["deepseek-flash->deepseek-flash"]);
      // No clinical content or credentials in any metering line.
      const serialized = JSON.stringify(logs);
      assert.ok(!serialized.includes("secret clinical text"));
      assert.ok(!serialized.includes("test-key"));
    }
  );
});

test("failed calls are recorded as failures with zero cost and the error still reaches the caller", async () => {
  await withDeepSeekStub(
    () => ({ ok: false, status: 500, text: async () => "boom" }),
    async ({ logs }) => {
      await fakeRequestCycle("research_search", async (res) => {
        await assert.rejects(() => callDeepSeek([{ role: "user", content: "q" }], { purpose: "research_synthesis" }), {
          code: "AI_PROVIDER_ERROR",
        });
        res.statusCode = 502;
      });
      const op = await waitForLog(logs, "ai_operation");
      assert.equal(op.calls, 1);
      assert.equal(op.failed_calls, 1);
      assert.equal(op.cost_usd, 0);
      assert.equal(op.completed, false);
      const call = logs.find((line) => line.type === "ai_call");
      assert.equal(call.ok, false);
      assert.equal(call.error_code, "AI_PROVIDER_ERROR:500");
    }
  );
});

test("metering failures never break the DeepSeek call", async () => {
  await withDeepSeekStub(
    () => okResponse({ prompt_tokens: 1, completion_tokens: 1 }),
    async () => {
      const originalStringify = JSON.stringify;
      let calls = 0;
      JSON.stringify = (value, ...rest) => {
        calls += 1;
        if (value && value.type === "ai_call") throw new Error("log sink down");
        return originalStringify(value, ...rest);
      };
      try {
        const content = await callDeepSeek([{ role: "user", content: "x" }]);
        assert.equal(content, "{\"ok\":true}");
        assert.ok(calls > 0);
      } finally {
        JSON.stringify = originalStringify;
      }
    }
  );
});
