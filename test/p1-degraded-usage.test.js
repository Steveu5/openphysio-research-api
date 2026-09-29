const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// Fake Supabase: RPCs are recorded; the released-count query returns `released`.
const supabasePath = path.join(__dirname, "../src/services/supabase.js");
const rpcCalls = [];
let released = 0;
let countFails = false;
const countQuery = {
  eq() { return countQuery; },
  then(resolve) {
    resolve(countFails ? { count: null, error: new Error("db down") } : { count: released, error: null });
  },
};
const fakeClient = {
  rpc: async (name, params) => {
    rpcCalls.push({ name, params });
    if (name === "release_usage_unit") return { data: { released: true }, error: null };
    if (name === "commit_usage_unit") return { data: true, error: null };
    return { data: null, error: null };
  },
  from: () => ({ select: () => countQuery }),
};
require.cache[require.resolve(supabasePath)] = {
  id: supabasePath,
  filename: supabasePath,
  loaded: true,
  exports: { getSupabaseAdmin: () => fakeClient },
};

const { settleUsage, DEGRADED_FREE_LIMIT } = require("../src/services/usageQuota");
const reservation = { id: "r1", tool: "chat", userId: "u1", periodKey: "2026-09" };
const names = () => rpcCalls.map((call) => call.name);

test("SUCCESS consumes exactly one unit", async () => {
  rpcCalls.length = 0;
  const result = await settleUsage(reservation, "success");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(result, { outcome: "success", charged: true });
  assert.deepEqual(names(), ["commit_usage_unit"]);
});

test("DEGRADED releases the unit within the per-period allowance", async () => {
  rpcCalls.length = 0;
  released = DEGRADED_FREE_LIMIT - 1;
  const result = await settleUsage(reservation, "degraded");
  assert.deepEqual(result, { outcome: "degraded", charged: false });
  assert.deepEqual(names(), ["release_usage_unit"]);
});

test("DEGRADED beyond the allowance is charged: no unlimited free retries", async () => {
  rpcCalls.length = 0;
  released = DEGRADED_FREE_LIMIT;
  const result = await settleUsage(reservation, "degraded");
  assert.equal(result.charged, true);
  assert.equal(result.reason, "degraded_free_limit_reached");
  assert.deepEqual(names(), ["commit_usage_unit"]);
});

test("DEGRADED is charged when the allowance cannot be verified", async () => {
  rpcCalls.length = 0;
  released = 0;
  countFails = true;
  const result = await settleUsage(reservation, "degraded");
  countFails = false;
  assert.equal(result.charged, true);
  assert.equal(result.reason, "settlement_check_failed");
  assert.deepEqual(names(), ["commit_usage_unit"]);
});

test("the degraded allowance is small and per tool/period", () => {
  assert.ok(DEGRADED_FREE_LIMIT >= 1 && DEGRADED_FREE_LIMIT <= 10);
});
