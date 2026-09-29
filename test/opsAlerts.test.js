const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_THRESHOLDS,
  thresholdsFromEnv,
  evaluateStripeAccess,
  evaluateAiErrors,
  evaluateResearchLatency,
  evaluateAiCost,
  evaluateAnalytics,
  evaluateAll,
  planIssueActions,
  renderBody,
} = require("../tools/ops/alertRules");
const { runChecks, runSmokeChecks } = require("../tools/ops/smokeChecks");

// All data below is simulated. No real users, payments or AI calls.
const NOW = new Date("2026-09-27T12:00:00Z");
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60000).toISOString();
const op = (tool, status, startedMinAgo, durationSec = 15, cost = 0.002) => ({
  user_id: `u-${startedMinAgo}`,
  tool,
  status,
  created_at: minutesAgo(startedMinAgo),
  committed_at: status === "committed" ? new Date(NOW.getTime() - startedMinAgo * 60000 + durationSec * 1000).toISOString() : null,
  cost_usd: status === "committed" ? cost : 0,
});
const SENSITIVE = /@|sk-|whsec_|sk_live|password|question|reply|clinical text/i;

// 1. Stripe stale -> alert
test("1. Stripe: active subscription whose period ended >3h ago alerts (stale)", () => {
  const alerts = evaluateStripeAccess({
    profiles: [
      { stripe_subscription_id: "sub_1Sik4pFAs6R6RieDp5JAxTcf", subscription_status: "active", current_period_end: minutesAgo(5 * 60) },
      { stripe_subscription_id: "sub_ok", subscription_status: "active", current_period_end: new Date(NOW.getTime() + 86400000).toISOString() },
      { stripe_subscription_id: "sub_renewing_now", subscription_status: "active", current_period_end: minutesAgo(60) },
    ],
    now: NOW,
  });
  assert.deepEqual(alerts.map((a) => a.key), ["stripe-stale:p5JAxTcf"]);
  assert.equal(alerts[0].fields.subscription, "…p5JAxTcf");
  assert.equal(alerts[0].fields.app_status, "active");
  assert.doesNotMatch(JSON.stringify(alerts), SENSITIVE);
});

test("1b/1c. Stripe: missing renewal and Stripe-active-but-app-denies both alert", () => {
  const alerts = evaluateStripeAccess({
    profiles: [{ stripe_subscription_id: "sub_denied_12345678", subscription_status: "past_due", current_period_end: null }],
    commercialStates: [
      { stripe_subscription_id: "sub_denied_12345678", status: "active", billing_period: "monthly", last_paid_at: minutesAgo(60 * 24 * 10) },
      { stripe_subscription_id: "sub_norenewal_ABCDEFGH", status: "active", billing_period: "monthly", last_paid_at: minutesAgo(60 * 24 * 40) },
      { stripe_subscription_id: "sub_annual_ok", status: "active", billing_period: "annual", last_paid_at: minutesAgo(60 * 24 * 200) },
    ],
    now: NOW,
  });
  assert.deepEqual(alerts.map((a) => a.key).sort(), ["stripe-access-mismatch:12345678", "stripe-renewal-missing:ABCDEFGH"]);
});

// 2. AI error rate > 15% -> alert, with a minimum volume
test("2. AI errors: >15% failures in the last hour alert per tool; tiny volume does not", () => {
  const reservations = [
    ...Array.from({ length: 8 }, (_, i) => op("chat", "committed", 5 + i)),
    op("chat", "released", 20), op("chat", "released", 25),
    op("research", "released", 10), // 1 of 2 research ops: below minimum volume
    op("research", "committed", 12),
    op("chat", "released", 120), // outside the 1h window
    op("chat", "rejected", 5), // over-limit attempts are not AI failures
  ];
  const alerts = evaluateAiErrors({ reservations, now: NOW, model: "deepseek-flash" });
  assert.deepEqual(alerts.map((a) => a.key), ["ai-errors:chat"]);
  assert.equal(alerts[0].fields.failure_rate, "20.0%");
  assert.equal(alerts[0].fields.total_operations, 10);
  assert.equal(alerts[0].fields.provider_model, "deepseek-flash");
});

// 3. Research p95 > 30s -> alert, only with enough samples
test("3. Research p95 above 30s alerts; too few samples does not", () => {
  const slow = [...Array.from({ length: 8 }, (_, i) => op("research", "committed", 30 + i, 20)), op("research", "committed", 50, 45), op("research", "committed", 55, 60)];
  const alerts = evaluateResearchLatency({ reservations: slow, now: NOW });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].key, "research-latency");
  assert.ok(Number(alerts[0].fields.p95_seconds) > 30);
  assert.deepEqual(evaluateResearchLatency({ reservations: slow.slice(-3), now: NOW }), []);
  assert.deepEqual(evaluateResearchLatency({ reservations: Array.from({ length: 12 }, (_, i) => op("research", "committed", 10 + i, 22)), now: NOW }), []);
});

// 4. AI daily cost > USD 5 -> alert with per-tool breakdown
test("4. AI cost above the daily threshold alerts with Chat/Research/total and op count", () => {
  const reservations = [...Array.from({ length: 30 }, (_, i) => op("chat", "committed", 10 + i, 15, 0.1)), ...Array.from({ length: 30 }, (_, i) => op("research", "committed", 50 + i, 15, 0.1))];
  const alerts = evaluateAiCost({ reservations, now: NOW });
  assert.equal(alerts[0].key, "ai-cost-daily");
  assert.equal(alerts[0].fields.cost_chat_usd, "3.0000");
  assert.equal(alerts[0].fields.cost_research_usd, "3.0000");
  assert.equal(alerts[0].fields.cost_total_usd, "6.0000");
  assert.equal(alerts[0].fields.operations, 60);
  assert.deepEqual(evaluateAiCost({ reservations: reservations.slice(0, 20), now: NOW }), []);
  // threshold is configurable without code changes
  assert.equal(thresholdsFromEnv({ OPS_AI_DAILY_COST_USD: "20" }).aiDailyCostUsd, 20);
  assert.deepEqual(evaluateAiCost({ reservations, now: NOW, thresholds: thresholdsFromEnv({ OPS_AI_DAILY_COST_USD: "20" }) }), []);
});

// 5 & 6. Analytics stale with / without traffic
test("5. Analytics stale for 24h while the app has traffic alerts", () => {
  const traffic = Array.from({ length: 6 }, (_, i) => op(i % 2 ? "chat" : "research", "committed", 60 * (i + 1)));
  const alerts = evaluateAnalytics({ lastAnalyticsAt: minutesAgo(60 * 30), reservations: traffic, now: NOW });
  assert.equal(alerts[0].key, "analytics-stale");
  assert.equal(alerts[0].fields.app_operations_in_window, 6);
});

test("6. Analytics stale without traffic does NOT alert; fresh analytics never alerts", () => {
  assert.deepEqual(evaluateAnalytics({ lastAnalyticsAt: minutesAgo(60 * 30), reservations: [op("chat", "committed", 60)], now: NOW }), []);
  const traffic = Array.from({ length: 10 }, (_, i) => op("chat", "committed", 30 + i));
  assert.deepEqual(evaluateAnalytics({ lastAnalyticsAt: minutesAgo(60), reservations: traffic, now: NOW }), []);
});

// 7. Repeated condition -> no spam
test("7. Repeated condition does not spam: silent update, one reminder per 24h", () => {
  const firing = [{ key: "ai-errors:chat", title: "AI errors", fields: { tool: "chat" } }];
  const scope = ["ai-"];
  const first = planIssueActions({ alerts: firing, issues: [], scopePrefixes: scope, now: NOW });
  assert.deepEqual(first.map((a) => a.type), ["create"]);

  const openIssue = { number: 7, state: "open", created_at: NOW.toISOString(), updated_at: NOW.toISOString(), body: renderBody(firing[0], NOW) };
  for (const minutes of [60, 120, 600, 1380]) {
    const later = new Date(NOW.getTime() + minutes * 60000);
    const acts = planIssueActions({ alerts: firing, issues: [openIssue], scopePrefixes: scope, now: later });
    assert.deepEqual(acts.map((a) => [a.type, a.comment]), [["update", null]], `no notification after ${minutes} min`);
  }
  const dayLater = new Date(NOW.getTime() + 25 * 3600000);
  const reminder = planIssueActions({ alerts: firing, issues: [openIssue], scopePrefixes: scope, now: dayLater });
  assert.equal(reminder[0].type, "remind");
  const remindedIssue = { ...openIssue, body: reminder[0].body };
  const after = planIssueActions({ alerts: firing, issues: [remindedIssue], scopePrefixes: scope, now: new Date(dayLater.getTime() + 3600000) });
  assert.equal(after[0].type, "update");
});

// 8. Recovery -> back to normal
test("8. Recovery closes the issue as RECOVERED; recurrence reopens the same issue", () => {
  const firing = { key: "stripe-stale:p5JAxTcf", title: "Stripe", fields: {} };
  const openIssue = { number: 3, state: "open", created_at: NOW.toISOString(), updated_at: NOW.toISOString(), body: renderBody(firing, NOW) };
  const resolved = planIssueActions({ alerts: [], issues: [openIssue], scopePrefixes: ["stripe-"], now: NOW });
  assert.equal(resolved[0].type, "resolve");
  assert.match(resolved[0].comment, /RECOVERED/);
  const reopened = planIssueActions({ alerts: [firing], issues: [{ ...openIssue, state: "closed" }], scopePrefixes: ["stripe-"], now: NOW });
  assert.equal(reopened[0].type, "reopen");
  assert.equal(reopened[0].number, 3);
});

test("runs are scoped: the hourly run never closes smoke issues and vice versa", () => {
  const smokeIssue = { number: 9, state: "open", created_at: NOW.toISOString(), updated_at: NOW.toISOString(), body: renderBody({ key: "smoke-frontend", fields: {} }, NOW) };
  assert.deepEqual(planIssueActions({ alerts: [], issues: [smokeIssue], scopePrefixes: ["stripe-", "ai-", "research-", "analytics-"], now: NOW }), []);
  assert.equal(planIssueActions({ alerts: [], issues: [smokeIssue], scopePrefixes: ["smoke-"], now: NOW })[0].type, "resolve");
});

test("current production-like data raises nothing (healthy baseline)", () => {
  const alerts = evaluateAll({
    profiles: [{ stripe_subscription_id: "sub_1Sik4pFAs6R6RieDp5JAxTcf", subscription_status: "active", current_period_end: "2026-10-26T23:05:43Z" }],
    commercialStates: [{ stripe_subscription_id: "sub_1Sik4pFAs6R6RieDp5JAxTcf", status: "active", billing_period: "monthly", last_paid_at: "2026-09-27T00:07:35Z" }],
    reservations: [op("chat", "committed", 30), op("research", "committed", 40)],
    lastAnalyticsAt: minutesAgo(60),
  }, NOW, DEFAULT_THRESHOLDS);
  assert.deepEqual(alerts, []);
});

// 6b. Daily smoke checks (fake network; no real requests)
function fakeFetch(overrides = {}) {
  return async (url, init = {}) => {
    const key = Object.keys(overrides).find((k) => url.includes(k));
    if (key && overrides[key] === "down") throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    const json = (status, body) => ({ status, json: async () => body });
    if (url.endsWith("/health")) return json(200, { status: "ok", ai_provider: { model: overrides.model || "deepseek-flash" } });
    if (url.endsWith("/health/ready")) return json(200, { status: "ready" });
    if (url.includes("/rest/v1/profiles")) return json(206, []);
    if (url.includes("stripe-webhook")) return json(400, { error: "Missing signature" });
    if (url.includes("analytics-ingest")) return json(200, {});
    return json(200, {});
  };
}

test("smoke: all checks pass -> no alerts; a failing check -> one smoke alert", async () => {
  const ok = await runChecks({ fetchImpl: fakeFetch(), supabaseUrl: "https://x.supabase.co", serviceKey: "k" });
  assert.equal(ok.length, 6);
  assert.ok(ok.every((c) => c.ok), JSON.stringify(ok));
  assert.deepEqual(await runSmokeChecks({ fetchImpl: fakeFetch(), supabaseUrl: "https://x.supabase.co", serviceKey: "k" }), []);
  const failing = await runSmokeChecks({ fetchImpl: fakeFetch({ "stripe-webhook": "down", model: "deepseek-chat" }), supabaseUrl: "https://x.supabase.co", serviceKey: "k" });
  assert.deepEqual(failing.map((a) => a.key).sort(), ["smoke-api-health", "smoke-stripe-webhook"]);
  assert.doesNotMatch(JSON.stringify(failing), /\bk\b.*Bearer|sk-/);
});

test("unset GitHub repository variables (empty strings) keep the default thresholds", () => {
  const blank = {
    OPS_AI_DAILY_COST_USD: "",
    OPS_AI_ERROR_RATE: "",
    OPS_AI_ERROR_MIN_OPS: " ",
    OPS_RESEARCH_P95_SECONDS: "",
    OPS_RESEARCH_MIN_SAMPLES: "",
    OPS_ANALYTICS_MIN_TRAFFIC_OPS: "",
  };
  assert.deepEqual(thresholdsFromEnv(blank), { ...DEFAULT_THRESHOLDS });
  assert.equal(thresholdsFromEnv({ OPS_RESEARCH_P95_SECONDS: "45" }).researchP95Seconds, 45);
  assert.equal(thresholdsFromEnv({ OPS_AI_DAILY_COST_USD: "abc" }).aiDailyCostUsd, 5);
});

test("provider health: alerts on a sustained provider failure rate, never on an isolated timeout", () => {
  const { evaluateProviderHealth } = require("../tools/ops/alertRules");
  const now = new Date("2026-09-29T12:00:00Z");
  const row = (minutesAgo, europeStatus, timedOut = europeStatus === "timeout") => ({
    created_at: new Date(now.getTime() - minutesAgo * 60000).toISOString(),
    retrieval: { status: "partial", providers: [
      { source: "pubmed", status: "ok" },
      { source: "europe_pmc", status: europeStatus, timed_out: timedOut },
      { source: "crossref", status: "ok" },
    ] },
  });
  // A single timeout among healthy operations: no alert.
  assert.deepEqual(evaluateProviderHealth({ now, retrievals: [row(5, "timeout"), ...Array.from({ length: 12 }, (_, i) => row(10 + i, "ok"))] }), []);
  // Few operations, all failing: below the minimum volume, no alert.
  assert.deepEqual(evaluateProviderHealth({ now, retrievals: Array.from({ length: 5 }, (_, i) => row(i, "timeout")) }), []);
  // Sustained: 8 of 12 Europe PMC calls timed out.
  const alerts = evaluateProviderHealth({ now, retrievals: [
    ...Array.from({ length: 8 }, (_, i) => row(i * 5, "timeout")),
    ...Array.from({ length: 4 }, (_, i) => row(50 + i, "ok")),
  ] });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].key, "provider-health-europe_pmc");
  assert.equal(alerts[0].fields.operations, 12);
  assert.equal(alerts[0].fields.timeouts, 8);
  // Only the configured window counts.
  assert.deepEqual(evaluateProviderHealth({ now, retrievals: Array.from({ length: 20 }, (_, i) => row(200 + i, "timeout")) }), []);
  // No clinical content in the alert.
  assert.doesNotMatch(JSON.stringify(alerts), /query|question|email/i);
});
