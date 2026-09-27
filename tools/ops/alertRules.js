// Pure evaluation rules for the minimal production alerts. No I/O here:
// tools/ops/run-ops-alerts.js fetches the data and turns the result into
// GitHub issues (OPEN / RECOVERED). Every alert carries only aggregated or
// truncated operational identifiers: never emails, names, prompts, answers,
// clinical content or secrets.

const ACCESS_STATUSES = new Set(["active", "trialing"]);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Thresholds can be overridden by env/GitHub repository variables without
// touching this logic (see thresholdsFromEnv).
const DEFAULT_THRESHOLDS = Object.freeze({
  stripeStaleGraceHours: 3, // Stripe finalizes and pays renewals ~1h after period end
  renewalGraceDays: 2,
  aiErrorRate: 0.15,
  aiErrorMinOps: 5,
  aiErrorWindowHours: 1,
  researchP95Seconds: 30,
  researchLatencyWindowHours: 6,
  researchLatencyMinSamples: 8,
  aiDailyCostUsd: 5,
  analyticsStaleHours: 24,
  analyticsMinTrafficOps: 5,
});

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function thresholdsFromEnv(env = process.env) {
  return {
    ...DEFAULT_THRESHOLDS,
    aiDailyCostUsd: numberOr(env.OPS_AI_DAILY_COST_USD, DEFAULT_THRESHOLDS.aiDailyCostUsd),
    aiErrorRate: numberOr(env.OPS_AI_ERROR_RATE, DEFAULT_THRESHOLDS.aiErrorRate),
    aiErrorMinOps: numberOr(env.OPS_AI_ERROR_MIN_OPS, DEFAULT_THRESHOLDS.aiErrorMinOps),
    researchP95Seconds: numberOr(env.OPS_RESEARCH_P95_SECONDS, DEFAULT_THRESHOLDS.researchP95Seconds),
    researchLatencyMinSamples: numberOr(env.OPS_RESEARCH_MIN_SAMPLES, DEFAULT_THRESHOLDS.researchLatencyMinSamples),
    analyticsMinTrafficOps: numberOr(env.OPS_ANALYTICS_MIN_TRAFFIC_OPS, DEFAULT_THRESHOLDS.analyticsMinTrafficOps),
  };
}

const ms = (value) => (value ? Date.parse(value) : NaN);
const shortId = (id) => (id ? `…${String(id).slice(-8)}` : "n/a");
const iso = (value) => (value ? new Date(value).toISOString() : "n/a");

function alert(key, title, fields) {
  return { key, title, fields };
}

/** Alert 1 — Stripe / access consistency. */
function evaluateStripeAccess({ profiles = [], commercialStates = [], now = new Date(), thresholds = DEFAULT_THRESHOLDS }) {
  const alerts = [];
  const t = now.getTime();
  const graceMs = thresholds.stripeStaleGraceHours * HOUR;

  // A. App grants a Stripe subscription whose period already ended: the
  // renewal/cancellation webhook did not update it.
  for (const p of profiles) {
    if (!p.stripe_subscription_id || !ACCESS_STATUSES.has(p.subscription_status)) continue;
    const end = ms(p.current_period_end);
    if (Number.isFinite(end) && end < t - graceMs) {
      alerts.push(alert(`stripe-stale:${String(p.stripe_subscription_id).slice(-8)}`, "Stripe/access: subscription period expired but still marked active", {
        problem: "current_period_end passed without a webhook update (renewal or cancellation not received)",
        subscription: shortId(p.stripe_subscription_id),
        app_status: p.subscription_status,
        current_period_end: iso(end),
      }));
    }
  }

  const profileBySub = new Map(profiles.filter((p) => p.stripe_subscription_id).map((p) => [p.stripe_subscription_id, p]));
  for (const c of commercialStates) {
    if (!c.stripe_subscription_id || !ACCESS_STATUSES.has(c.status)) continue;

    // B. Stripe-side state says active but no payment arrived for longer
    // than one billing period: renewal events are not being delivered.
    if (c.status === "active" && c.last_paid_at) {
      const periodDays = c.billing_period === "annual" || c.billing_period === "yearly" ? 366 : 31;
      const expectedBy = ms(c.last_paid_at) + (periodDays + thresholds.renewalGraceDays) * DAY;
      if (Number.isFinite(expectedBy) && expectedBy < t) {
        alerts.push(alert(`stripe-renewal-missing:${String(c.stripe_subscription_id).slice(-8)}`, "Stripe/access: expected renewal not received", {
          problem: "no paid invoice recorded for longer than one billing period (Stripe deliveries may be failing)",
          subscription: shortId(c.stripe_subscription_id),
          stripe_state: c.status,
          last_paid_at: iso(c.last_paid_at),
        }));
      }
    }

    // C. Stripe-side state grants access but the app denies it.
    const p = profileBySub.get(c.stripe_subscription_id);
    if (p) {
      const end = ms(p.current_period_end);
      const appGrants = ACCESS_STATUSES.has(p.subscription_status) && (!Number.isFinite(end) || end > t);
      if (!appGrants) {
        alerts.push(alert(`stripe-access-mismatch:${String(c.stripe_subscription_id).slice(-8)}`, "Stripe/access: Stripe says active but the app denies access", {
          problem: "paying customer may be locked out",
          subscription: shortId(c.stripe_subscription_id),
          stripe_state: c.status,
          app_status: p.subscription_status || "none",
          current_period_end: iso(p.current_period_end),
        }));
      }
    }
  }
  return alerts;
}

function withinWindow(rows, now, hours, field = "created_at") {
  const from = now.getTime() - hours * HOUR;
  return rows.filter((r) => ms(r[field]) >= from && ms(r[field]) <= now.getTime());
}

/** Alert 2 — AI operation failures (released units = operations that failed). */
function evaluateAiErrors({ reservations = [], now = new Date(), thresholds = DEFAULT_THRESHOLDS, model = null }) {
  const alerts = [];
  const recent = withinWindow(reservations, now, thresholds.aiErrorWindowHours);
  for (const tool of ["chat", "research"]) {
    const done = recent.filter((r) => r.tool === tool && (r.status === "committed" || r.status === "released"));
    const failed = done.filter((r) => r.status === "released").length;
    if (done.length < thresholds.aiErrorMinOps) continue;
    const rate = failed / done.length;
    if (rate > thresholds.aiErrorRate) {
      alerts.push(alert(`ai-errors:${tool}`, `AI errors: ${tool} failure rate above ${Math.round(thresholds.aiErrorRate * 100)}%`, {
        tool,
        provider_model: model || "deepseek (see /health)",
        window: `last ${thresholds.aiErrorWindowHours}h`,
        failed_operations: failed,
        total_operations: done.length,
        failure_rate: `${(rate * 100).toFixed(1)}%`,
      }));
    }
  }
  return alerts;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/** Alert 3 — Research latency (reservation to completed response). */
function evaluateResearchLatency({ reservations = [], now = new Date(), thresholds = DEFAULT_THRESHOLDS }) {
  const recent = withinWindow(reservations, now, thresholds.researchLatencyWindowHours)
    .filter((r) => r.tool === "research" && r.status === "committed" && r.committed_at);
  const seconds = recent.map((r) => (ms(r.committed_at) - ms(r.created_at)) / 1000).filter((s) => Number.isFinite(s) && s >= 0);
  if (seconds.length < thresholds.researchLatencyMinSamples) return [];
  const p95 = percentile(seconds, 95);
  if (p95 <= thresholds.researchP95Seconds) return [];
  return [alert("research-latency", `Research slow: p95 above ${thresholds.researchP95Seconds}s`, {
    window: `last ${thresholds.researchLatencyWindowHours}h`,
    samples: seconds.length,
    p50_seconds: percentile(seconds, 50).toFixed(1),
    p95_seconds: p95.toFixed(1),
    max_seconds: Math.max(...seconds).toFixed(1),
  })];
}

/** Alert 4 — Daily AI cost (UTC day). Alert only; never blocks anything. */
function evaluateAiCost({ reservations = [], now = new Date(), thresholds = DEFAULT_THRESHOLDS }) {
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const today = reservations.filter((r) => ms(r.created_at) >= dayStart);
  const cost = (tool) => today.filter((r) => !tool || r.tool === tool).reduce((s, r) => s + Number(r.cost_usd || 0), 0);
  const total = cost();
  if (total <= thresholds.aiDailyCostUsd) return [];
  return [alert("ai-cost-daily", `AI cost: today above USD ${thresholds.aiDailyCostUsd}`, {
    day_utc: new Date(dayStart).toISOString().slice(0, 10),
    cost_chat_usd: cost("chat").toFixed(4),
    cost_research_usd: cost("research").toFixed(4),
    cost_total_usd: total.toFixed(4),
    operations: today.filter((r) => r.status === "committed" || r.status === "released").length,
    threshold_usd: thresholds.aiDailyCostUsd,
  })];
}

/** Alert 5 — Analytics ingestion stale while the app has real activity. */
function evaluateAnalytics({ lastAnalyticsAt = null, reservations = [], now = new Date(), thresholds = DEFAULT_THRESHOLDS }) {
  const staleMs = thresholds.analyticsStaleHours * HOUR;
  const last = ms(lastAnalyticsAt);
  const stale = !Number.isFinite(last) || last < now.getTime() - staleMs;
  if (!stale) return [];
  const activity = withinWindow(reservations, now, thresholds.analyticsStaleHours)
    .filter((r) => r.status === "committed" || r.status === "released");
  const users = new Set(activity.map((r) => r.user_id).filter(Boolean)).size;
  if (activity.length < thresholds.analyticsMinTrafficOps) return [];
  return [alert("analytics-stale", `Analytics: no events for ${thresholds.analyticsStaleHours}h despite app activity`, {
    last_event_received_at: iso(lastAnalyticsAt),
    app_operations_in_window: activity.length,
    active_users_in_window: users,
    note: "analytics is consent-gated; check GTM/consent banner and analytics-ingest",
  })];
}

function evaluateAll(data, now = new Date(), thresholds = DEFAULT_THRESHOLDS) {
  return [
    ...evaluateStripeAccess({ ...data, now, thresholds }),
    ...evaluateAiErrors({ ...data, now, thresholds }),
    ...evaluateResearchLatency({ ...data, now, thresholds }),
    ...evaluateAiCost({ ...data, now, thresholds }),
    ...evaluateAnalytics({ ...data, now, thresholds }),
  ];
}

// ---------------------------------------------------------------------------
// Issue state machine (anti-spam). One GitHub issue per alert key:
//   firing, no issue            -> create (OPEN, notifies once)
//   firing, closed recently     -> reopen (OPEN again, notifies once)
//   firing, already open        -> update body silently; remind every 24h
//   not firing, open            -> comment RECOVERED and close (notifies once)
// Only keys whose prefix belongs to the current run's scope are managed, so
// the hourly run never closes daily smoke-check issues and vice versa.
const MARKER = /<!-- ops-alert-key: ([^ ]+) -->/;
const NOTICE_MARKER = /<!-- ops-alert-notice: ([^ ]+) -->/;
const REMINDER_MS = 24 * HOUR;

function issueKey(issue) {
  return (String(issue.body || "").match(MARKER) || [])[1] || null;
}

function lastNoticeAt(issue) {
  return (String(issue.body || "").match(NOTICE_MARKER) || [])[1] || issue.created_at;
}

function renderBody(a, now, noticeAt = now) {
  const rows = Object.entries(a.fields).map(([k, v]) => `| ${k} | ${String(v).replace(/\|/g, "/")} |`).join("\n");
  return `<!-- ops-alert-key: ${a.key} -->\n<!-- ops-alert-notice: ${new Date(noticeAt).toISOString()} -->\n**Status: OPEN** · detected ${now.toISOString()}\n\n| field | value |\n|---|---|\n${rows}\n\n_Automated OpenPhysioAI production alert. Operational data only — no personal or clinical data. Closes automatically as RECOVERED when the condition clears._`;
}

function planIssueActions({ alerts, issues, scopePrefixes, now = new Date() }) {
  const actions = [];
  const inScope = (key) => scopePrefixes.some((p) => key.startsWith(p));
  const byKey = new Map();
  for (const issue of issues) {
    const key = issueKey(issue);
    if (!key || !inScope(key)) continue;
    const prev = byKey.get(key);
    if (!prev || (issue.state === "open" && prev.state !== "open") || ms(issue.updated_at) > ms(prev.updated_at)) byKey.set(key, issue);
  }
  const firing = new Map(alerts.filter((a) => inScope(a.key)).map((a) => [a.key, a]));

  for (const [key, a] of firing) {
    const issue = byKey.get(key);
    if (!issue) actions.push({ type: "create", key, title: `[ops-alert] ${a.title}`, body: renderBody(a, now) });
    else if (issue.state !== "open") actions.push({ type: "reopen", key, number: issue.number, body: renderBody(a, now), comment: `**OPEN again** at ${now.toISOString()}` });
    else {
      const lastNotice = ms(lastNoticeAt(issue));
      const remind = !Number.isFinite(lastNotice) || now.getTime() - lastNotice >= REMINDER_MS;
      actions.push({
        type: remind ? "remind" : "update",
        key,
        number: issue.number,
        body: renderBody(a, now, remind ? now : lastNotice),
        comment: remind ? `Still OPEN at ${now.toISOString()} (daily reminder)` : null,
      });
    }
  }
  for (const [key, issue] of byKey) {
    if (issue.state === "open" && !firing.has(key)) {
      actions.push({ type: "resolve", key, number: issue.number, comment: `**RECOVERED** at ${now.toISOString()} — condition no longer detected.` });
    }
  }
  return actions;
}

module.exports = {
  DEFAULT_THRESHOLDS,
  thresholdsFromEnv,
  evaluateStripeAccess,
  evaluateAiErrors,
  evaluateResearchLatency,
  evaluateAiCost,
  evaluateAnalytics,
  evaluateAll,
  percentile,
  planIssueActions,
  issueKey,
  renderBody,
};
