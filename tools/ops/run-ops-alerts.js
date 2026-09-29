#!/usr/bin/env node
// Minimal production monitoring for OpenPhysioAI.
//
//   node tools/ops/run-ops-alerts.js alerts        # hourly: Stripe/access, AI errors, Research p95, AI cost, analytics, provider health
//   node tools/ops/run-ops-alerts.js smoke         # daily: non-destructive endpoint checks
//   node tools/ops/run-ops-alerts.js channel-test  # opens and closes one test issue to confirm notifications
//   add --dry-run to print the planned issue actions without touching GitHub
//
// Channel: GitHub issues labelled `ops-alert` in this repository. A problem
// opens one issue (GitHub notifies watchers once), stays silent while it
// persists (one reminder per 24h), and is closed with a RECOVERED comment when
// it clears. Reads only operational columns; never emails, names, prompts,
// answers or clinical content.

const { createClient } = require("@supabase/supabase-js");
const { evaluateAll, planIssueActions, thresholdsFromEnv } = require("./alertRules");
const { runSmokeChecks } = require("./smokeChecks");

const mode = process.argv[2] || "alerts";
const dryRun = process.argv.includes("--dry-run");
const LABEL = "ops-alert";
const SCOPES = {
  alerts: ["stripe-", "ai-", "research-", "analytics-", "provider-health-", "ops-monitor-"],
  smoke: ["smoke-"],
  "channel-test": ["channel-test"],
};

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

async function fetchAlertData() {
  const supabase = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const since = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
  const retrievalSince = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const [profiles, states, reservations, analytics, retrievals] = await Promise.all([
    supabase.from("profiles").select("stripe_subscription_id,subscription_status,current_period_end").not("stripe_subscription_id", "is", null),
    supabase.from("commercial_subscription_state").select("stripe_subscription_id,status,billing_period,last_paid_at"),
    supabase.from("usage_reservations").select("user_id,tool,status,created_at,committed_at,cost_usd").gte("created_at", since).limit(20000),
    supabase.from("analytics_events").select("received_at").order("received_at", { ascending: false }).limit(1),
    // Only the per-provider retrieval outcome (no query text, no user data).
    supabase.from("research_search_queries").select("created_at,retrieval:parsed_query->_openphysio_retrieval").gte("created_at", retrievalSince).limit(5000),
  ]);
  for (const [name, r] of Object.entries({ profiles, states, reservations, analytics, retrievals })) {
    if (r.error) throw new Error(`Supabase read failed (${name}): ${r.error.message}`);
  }
  return {
    profiles: profiles.data,
    commercialStates: states.data,
    reservations: reservations.data,
    lastAnalyticsAt: analytics.data?.[0]?.received_at || null,
    retrievals: retrievals.data || [],
  };
}

async function github(path, options = {}) {
  const repo = required("GITHUB_REPOSITORY");
  const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${required("GITHUB_TOKEN")}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub ${options.method || "GET"} ${path} -> ${response.status} ${(await response.text()).slice(0, 200)}`);
  return response.status === 204 ? null : response.json();
}

async function listAlertIssues() {
  const issues = [];
  for (let page = 1; page <= 5; page += 1) {
    const batch = await github(`/issues?labels=${LABEL}&state=all&per_page=100&page=${page}`);
    issues.push(...batch.filter((i) => !i.pull_request));
    if (batch.length < 100) break;
  }
  return issues;
}

async function applyActions(actions) {
  const touched = [];
  for (const a of actions) {
    if (a.type === "create") {
      const created = await github("/issues", { method: "POST", body: JSON.stringify({ title: a.title, body: a.body, labels: [LABEL] }) });
      touched.push(created.number);
    } else if (a.type === "reopen") {
      await github(`/issues/${a.number}`, { method: "PATCH", body: JSON.stringify({ state: "open", body: a.body }) });
      await github(`/issues/${a.number}/comments`, { method: "POST", body: JSON.stringify({ body: a.comment }) });
    } else if (a.type === "update") {
      await github(`/issues/${a.number}`, { method: "PATCH", body: JSON.stringify({ body: a.body }) });
    } else if (a.type === "remind") {
      await github(`/issues/${a.number}`, { method: "PATCH", body: JSON.stringify({ body: a.body }) });
      await github(`/issues/${a.number}/comments`, { method: "POST", body: JSON.stringify({ body: a.comment }) });
    } else if (a.type === "resolve") {
      await github(`/issues/${a.number}/comments`, { method: "POST", body: JSON.stringify({ body: a.comment }) });
      await github(`/issues/${a.number}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "completed" }) });
    }
    if (a.number) touched.push(a.number);
  }
  return touched;
}

async function main() {
  if (!SCOPES[mode]) throw new Error(`Unknown mode ${mode}`);
  const now = new Date();
  let alerts;
  let scope = SCOPES[mode];
  if (mode === "alerts") {
    try {
      alerts = evaluateAll(await fetchAlertData(), now, thresholdsFromEnv());
    } catch (error) {
      // Report once as its own alert instead of failing every hour. Other
      // open alerts are left untouched: without data we cannot tell whether
      // they recovered.
      alerts = [{ key: "ops-monitor-read-failed", title: "Monitoring could not read production data", fields: { error: String(error.message).slice(0, 160), at: now.toISOString() } }];
      scope = ["ops-monitor-"];
    }
  }
  else if (mode === "smoke") alerts = await runSmokeChecks();
  else alerts = [{ key: "channel-test", title: "Channel test (safe to ignore; closes automatically)", fields: { purpose: "confirm GitHub notifications for ops alerts", at: now.toISOString() } }];

  const issues = dryRun && !process.env.GITHUB_TOKEN ? [] : await listAlertIssues();
  const actions = planIssueActions({ alerts, issues, scopePrefixes: scope, now });
  console.log(JSON.stringify({ mode, firing: alerts.map((a) => a.key), actions: actions.map(({ type, key, number }) => ({ type, key, number })) }, null, 2));
  if (dryRun) return;
  const touched = await applyActions(actions);
  if (mode === "channel-test") {
    // Resolve the issue(s) just opened/updated, by number: GitHub's label
    // listing is eventually consistent and may not return a brand-new issue
    // yet. The watcher gets one OPEN and one RECOVERED notification.
    const numbers = [...new Set(touched)];
    await applyActions(numbers.map((number) => ({ type: "resolve", number, comment: `**RECOVERED** at ${new Date().toISOString()} — channel test complete.` })));
  }
}

main().catch((error) => {
  console.error("ops alerts run failed:", error.message);
  process.exit(1);
});
