const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// Fake Supabase: RPCs are recorded; the first release can be made to fail.
const supabasePath = path.join(__dirname, "../src/services/supabase.js");
const rpcCalls = [];
let failNextRelease = false;
const fakeClient = {
  rpc: async (name, params) => {
    rpcCalls.push({ name, params });
    if (name === "release_usage_unit") {
      if (failNextRelease) { failNextRelease = false; return { data: null, error: new Error("transient") }; }
      return { data: { released: true }, error: null };
    }
    if (name === "commit_usage_unit") return { data: true, error: null };
    return { data: null, error: null };
  },
  from: () => { throw new Error("no table access expected"); },
};
require.cache[require.resolve(supabasePath)] = { id: supabasePath, filename: supabasePath, loaded: true, exports: { getSupabaseAdmin: () => fakeClient } };

const { settleUsage } = require("../src/services/usageQuota");
const cooldown = require("../src/services/degradedCooldown");
const { publicErrorResponse } = require("../src/services/publicError");

const reservation = (userId = "u1", tool = "chat") => ({ id: `r-${Math.random()}`, tool, userId, periodKey: "2026-09" });
const names = () => rpcCalls.map((call) => call.name);
const settle = async (...args) => { const r = await settleUsage(...args); await new Promise((resolve) => setImmediate(resolve)); return r; };

test("SUCCESS (incl. insufficient-evidence and safety answers) consumes exactly one unit", async () => {
  rpcCalls.length = 0;
  assert.deepEqual(await settle(reservation(), "success"), { outcome: "success", charged: true });
  assert.deepEqual(names(), ["commit_usage_unit"]);
});

test("DEGRADED never consumes a unit, however many times it happens", async () => {
  cooldown.resetDegradedCooldowns();
  rpcCalls.length = 0;
  for (let i = 0; i < 20; i += 1) {
    const result = await settle(reservation(`user-${i}`), "degraded");
    assert.deepEqual(result, { outcome: "degraded", charged: false });
  }
  assert.ok(names().every((name) => name === "release_usage_unit"));
  assert.equal(names().filter((name) => name === "commit_usage_unit").length, 0);
});

test("DEGRADED retries the release once if it fails transiently", async () => {
  rpcCalls.length = 0;
  failNextRelease = true;
  const result = await settle(reservation(), "degraded");
  assert.equal(result.charged, false);
  assert.deepEqual(names(), ["release_usage_unit", "release_usage_unit"]);
});

test("repeated degraded answers trigger a short cooldown, never a charge", async () => {
  cooldown.resetDegradedCooldowns();
  const now = Date.now();
  for (let i = 0; i < cooldown.DEGRADED_BURST - 1; i += 1) cooldown.recordDegraded("abuser", "chat", now + i);
  assert.equal(cooldown.cooldownRemainingSeconds("abuser", "chat", now + 10), 0);
  cooldown.recordDegraded("abuser", "chat", now + 20);
  assert.ok(cooldown.cooldownRemainingSeconds("abuser", "chat", now + 30) > 0);
  // Per user and per tool.
  assert.equal(cooldown.cooldownRemainingSeconds("abuser", "research", now + 30), 0);
  assert.equal(cooldown.cooldownRemainingSeconds("someone-else", "chat", now + 30), 0);
  // The refusal is a clear 429 with a retry time; it is raised before any
  // reservation, so nothing is reserved or charged.
  let error;
  try { cooldown.assertNotCoolingDown("abuser", "chat", now + 30); } catch (e) { error = e; }
  assert.equal(error.status, 429);
  assert.equal(error.code, "DEGRADED_COOLDOWN");
  const response = publicErrorResponse(error);
  assert.equal(response.payload.code, "DEGRADED_COOLDOWN");
  assert.ok(response.payload.retry_after_seconds > 0);
  // It expires.
  assert.equal(cooldown.cooldownRemainingSeconds("abuser", "chat", now + cooldown.DEGRADED_COOLDOWN_MS + 1000), 0);
});

test("degraded answers spread over time do not trigger the cooldown", () => {
  cooldown.resetDegradedCooldowns();
  const now = Date.now();
  for (let i = 0; i < 6; i += 1) cooldown.recordDegraded("steady", "chat", now + i * (cooldown.DEGRADED_WINDOW_MS / 2 + 1000));
  assert.equal(cooldown.cooldownRemainingSeconds("steady", "chat", now + 6 * (cooldown.DEGRADED_WINDOW_MS / 2 + 1000)), 0);
});

test("routes check the cooldown before reserving a unit", () => {
  const fs = require("node:fs");
  for (const [file, tool, reserve] of [["chat.js", "chat", "const quotaReservation = await reserveUsage"], ["research.js", "research", "const usageReservation = await reserveUsage"]]) {
    const source = fs.readFileSync(path.join(__dirname, "../src/routes", file), "utf8");
    const check = source.indexOf(`assertNotCoolingDown(req.user.id, "${tool}")`);
    assert.ok(check > 0 && check < source.indexOf(reserve), file);
  }
});
