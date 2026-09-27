// Daily non-destructive production checks. No Chat/Research operation, no
// quota use, no payment: only health endpoints, a signature-less POST that the
// Stripe webhook must reject with 400, a CORS preflight to analytics-ingest,
// and one head-only Supabase read.

const FRONTEND = process.env.OPS_FRONTEND_URL || "https://openphysioaihub.com";
const API = process.env.OPS_API_URL || "https://api.openphysiohub.com";
const EXPECTED_MODEL = process.env.OPS_EXPECTED_AI_MODEL || "deepseek-flash";

async function timed(fn) {
  try {
    return await fn();
  } catch (error) {
    return { ok: false, detail: `request failed: ${String(error?.cause?.code || error?.name || "error")}` };
  }
}

function check(name, result) {
  return { name, ...result };
}

async function runChecks({ fetchImpl = fetch, supabaseUrl = process.env.SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY } = {}) {
  const get = (url, init = {}) => fetchImpl(url, { ...init, signal: AbortSignal.timeout(20000) });
  const results = [];

  results.push(check("frontend", await timed(async () => {
    const r = await get(FRONTEND);
    return { ok: r.status === 200, detail: `HTTP ${r.status}` };
  })));
  results.push(check("api-health", await timed(async () => {
    const r = await get(`${API}/health`);
    const body = await r.json().catch(() => ({}));
    const model = body?.ai_provider?.model;
    return { ok: r.status === 200 && body.status === "ok" && model === EXPECTED_MODEL, detail: `HTTP ${r.status}, status=${body.status}, ai_model=${model}` };
  })));
  results.push(check("api-ready", await timed(async () => {
    const r = await get(`${API}/health/ready`);
    const body = await r.json().catch(() => ({}));
    return { ok: r.status === 200 && body.status === "ready", detail: `HTTP ${r.status}, status=${body.status} (includes DeepSeek/Supabase configuration)` };
  })));
  results.push(check("supabase", await timed(async () => {
    const r = await get(`${supabaseUrl}/rest/v1/profiles?select=id&limit=1`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: "count=exact", Range: "0-0" } });
    return { ok: r.status === 200 || r.status === 206, detail: `HTTP ${r.status}` };
  })));
  results.push(check("stripe-webhook", await timed(async () => {
    const r = await get(`${supabaseUrl}/functions/v1/stripe-webhook`, { method: "POST", body: "{}" });
    const body = await r.json().catch(() => ({}));
    return { ok: r.status === 400 && body.error === "Missing signature", detail: `HTTP ${r.status} (expects 400 "Missing signature": function up and verifying signatures)` };
  })));
  results.push(check("analytics-ingest", await timed(async () => {
    const r = await get(`${supabaseUrl}/functions/v1/analytics-ingest`, { method: "OPTIONS", headers: { Origin: FRONTEND, "Access-Control-Request-Method": "POST" } });
    return { ok: r.status === 200 || r.status === 204, detail: `HTTP ${r.status}` };
  })));
  return results;
}

async function runSmokeChecks(options) {
  const results = await runChecks(options);
  return results.filter((r) => !r.ok).map((r) => ({
    key: `smoke-${r.name}`,
    title: `Daily smoke check failed: ${r.name}`,
    fields: { check: r.name, result: r.detail, checked_at: new Date().toISOString() },
  }));
}

module.exports = { runChecks, runSmokeChecks };
