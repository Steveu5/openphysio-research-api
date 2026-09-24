const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// Replace the Supabase admin client with a fake before loading the module.
const supabasePath = path.join(__dirname, "../src/services/supabase.js");
const rpcCalls = [];
let rpcResponses = {};
const fakeClient = {
  rpc: async (name, params) => {
    rpcCalls.push({ name, params });
    const next = rpcResponses[name];
    return typeof next === "function" ? next(params) : next || { data: null, error: null };
  },
  from: (table) => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { used_count: table === "chat_usage" ? 7 : 3 }, error: null }),
        }),
      }),
    }),
  }),
};
require.cache[require.resolve(supabasePath)] = {
  id: supabasePath,
  filename: supabasePath,
  loaded: true,
  exports: { getSupabaseAdmin: () => fakeClient },
};

const {
  resolveUsagePeriod,
  resolveIdempotencyKey,
  reserveUsage,
  releaseUsage,
  commitUsage,
  getUsageSummary,
} = require("../src/services/usageQuota");
const { USAGE_PLANS } = require("../src/config/usagePlans");
const { publicErrorResponse } = require("../src/services/publicError");

test("commercial allowances: paid 200/100 per month, trial 20/10 in total", () => {
  assert.deepEqual(USAGE_PLANS.paid, { chat: 200, research: 100 });
  assert.deepEqual(USAGE_PLANS.trial, { chat: 20, research: 10 });
});

test("paid period is the UTC calendar month, never the browser's timezone", () => {
  // 23:30 on Sep 30 in Lima (UTC-5) is already October in UTC.
  const period = resolveUsagePeriod({
    subscriptionStatus: "active",
    now: new Date("2026-09-30T23:30:00-05:00"),
  });
  assert.equal(period.key, "2026-10");
  assert.equal(period.resetsAt, "2026-11-01T00:00:00.000Z");
  assert.equal(period.timezone, "UTC");
  assert.deepEqual(period.limits, { chat: 200, research: 100 });
});

test("trial uses a fixed period key that no month change can renew", () => {
  const sept = resolveUsagePeriod({ subscriptionStatus: "trialing", now: new Date("2026-09-30T12:00:00Z") });
  const oct = resolveUsagePeriod({ subscriptionStatus: "TRIALING", now: new Date("2026-10-01T12:00:00Z") });
  assert.equal(sept.key, "trial");
  assert.equal(oct.key, "trial");
  assert.equal(sept.resetsAt, null);
  assert.deepEqual(sept.limits, { chat: 20, research: 10 });
});

test("after conversion (trialing -> active) the paid monthly allowance applies", () => {
  const period = resolveUsagePeriod({ subscriptionStatus: "active", now: new Date("2026-09-24T00:00:00Z") });
  assert.equal(period.plan, "paid");
  assert.equal(period.key, "2026-09");
});

test("idempotency key: a valid client key is kept, anything else gets a fresh server key", () => {
  const req = (value) => ({ get: (name) => (name === "Idempotency-Key" ? value : undefined) });
  assert.equal(resolveIdempotencyKey(req("chat-2f1c9a7e-1234")), "chat-2f1c9a7e-1234");
  assert.match(resolveIdempotencyKey(req("short")), /^srv-/);
  assert.match(resolveIdempotencyKey(req("bad key with spaces!!")), /^srv-/);
  assert.match(resolveIdempotencyKey(req(undefined)), /^srv-/);
  assert.notEqual(resolveIdempotencyKey(req(undefined)), resolveIdempotencyKey(req(undefined)));
});

test("reserve passes the plan limit and period key for the tool", async () => {
  rpcCalls.length = 0;
  rpcResponses = { reserve_usage_unit: { data: { outcome: "reserved", reservation_id: "r1", used: 5, limit: 20 }, error: null } };
  const result = await reserveUsage({ userId: "u", tool: "chat", subscriptionStatus: "trialing", idempotencyKey: "k-12345678" });
  assert.deepEqual(rpcCalls[0], {
    name: "reserve_usage_unit",
    params: { p_user_id: "u", p_tool: "chat", p_period_key: "trial", p_limit: 20, p_idempotency_key: "k-12345678" },
  });
  assert.deepEqual(result.reservation, { id: "r1", tool: "chat" });
  assert.equal(result.usage.remaining, 15);

  rpcCalls.length = 0;
  await reserveUsage({ userId: "u", tool: "research", subscriptionStatus: "active", idempotencyKey: "k-12345678" });
  assert.equal(rpcCalls[0].params.p_limit, 100);
  assert.match(rpcCalls[0].params.p_period_key, /^\d{4}-\d{2}$/);
});

test("exhausted allowance is a 429 with a tool-specific code and the caller's usage", async () => {
  rpcResponses = { reserve_usage_unit: { data: { outcome: "exceeded", used: 100, limit: 100 }, error: null } };
  await assert.rejects(
    () => reserveUsage({ userId: "u", tool: "research", subscriptionStatus: "active", idempotencyKey: "k-12345678" }),
    (error) => {
      assert.equal(error.status, 429);
      assert.equal(error.code, "RESEARCH_QUOTA_EXCEEDED");
      assert.equal(error.details.remaining, 0);
      const { payload } = publicErrorResponse(error);
      assert.equal(payload.code, "RESEARCH_QUOTA_EXCEEDED");
      assert.equal(payload.usage.limit, 100);
      assert.equal(payload.usage.period.timezone, "UTC");
      return true;
    }
  );

  rpcResponses = { reserve_usage_unit: { data: { outcome: "exceeded", used: 200, limit: 200 }, error: null } };
  await assert.rejects(
    () => reserveUsage({ userId: "u", tool: "chat", subscriptionStatus: "active", idempotencyKey: "k-12345678" }),
    { status: 429, code: "CHAT_QUOTA_EXCEEDED" }
  );
});

test("a repeated operation is never charged twice", async () => {
  rpcResponses = { reserve_usage_unit: { data: { outcome: "in_progress", reservation_id: "r1" }, error: null } };
  await assert.rejects(
    () => reserveUsage({ userId: "u", tool: "chat", subscriptionStatus: "active", idempotencyKey: "k-12345678" }),
    { status: 409, code: "REQUEST_IN_PROGRESS" }
  );
  rpcResponses = { reserve_usage_unit: { data: { outcome: "duplicate", reservation_id: "r1" }, error: null } };
  await assert.rejects(
    () => reserveUsage({ userId: "u", tool: "chat", subscriptionStatus: "active", idempotencyKey: "k-12345678" }),
    { status: 409, code: "DUPLICATE_REQUEST" }
  );
});

test("release and commit call their functions and never throw", async () => {
  rpcCalls.length = 0;
  rpcResponses = {
    release_usage_unit: { data: { released: true }, error: null },
    commit_usage_unit: { data: true, error: null },
  };
  assert.equal(await releaseUsage({ id: "r1" }), true);
  assert.equal(await commitUsage({ id: "r2" }), true);
  assert.deepEqual(rpcCalls.map((c) => [c.name, c.params.p_reservation_id]), [
    ["release_usage_unit", "r1"],
    ["commit_usage_unit", "r2"],
  ]);

  rpcResponses = { release_usage_unit: { data: null, error: new Error("db down") } };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await releaseUsage({ id: "r1" }), false);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(await releaseUsage(null), false);
});

test("usage summary reports both tools independently for the current period", async () => {
  const summary = await getUsageSummary({ userId: "u", subscriptionStatus: "active" });
  assert.equal(summary.plan, "paid");
  assert.deepEqual(summary.chat, { used: 7, limit: 200, remaining: 193 });
  assert.deepEqual(summary.research, { used: 3, limit: 100, remaining: 97 });
  const trial = await getUsageSummary({ userId: "u", subscriptionStatus: "trialing", currentPeriodEnd: "2026-09-29T00:00:00Z" });
  assert.deepEqual(trial.chat, { used: 7, limit: 20, remaining: 13 });
  assert.equal(trial.period.trialEndsAt, "2026-09-29T00:00:00Z");
});
