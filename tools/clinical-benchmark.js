#!/usr/bin/env node
// Reproducible clinical-behavior benchmark for Chat and Research.
//
//   BENCH_API_ROOT=http://127.0.0.1:3099 BENCH_SUPABASE_URL=... BENCH_ANON_KEY=... \
//   BENCH_SERVICE_KEY=... BENCH_EMAIL=... BENCH_PASSWORD=... \
//     node tools/clinical-benchmark.js --label before [--only id1,id2]
//
// Runs every case in benchmarks/clinical/cases.json against a running API
// (normally a local API backed by a local Supabase stack), stores the raw
// observations in benchmarks/clinical/results/<label>.json and prints a
// summary. Checks are generic (no per-question logic lives in product code).
// Use `node tools/clinical-benchmark.js --compare before after` to diff runs.

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
// --cases <file> runs another case set (default: cases.json).
const CASES_FILE = process.argv.includes("--cases")
  ? path.resolve(process.argv[process.argv.indexOf("--cases") + 1])
  : path.join(ROOT, "benchmarks/clinical/cases.json");
const CASES = JSON.parse(fs.readFileSync(CASES_FILE, "utf8")).cases;
// New runs are written to runs/ (gitignored, local output). results/ keeps
// the small set of reference runs that are versioned; both are readable.
const RUNS_DIR = path.join(ROOT, "benchmarks/clinical/runs");
const RESULTS_DIR = path.join(ROOT, "benchmarks/clinical/results");
function runFile(label) {
  const local = path.join(RUNS_DIR, `${label}.json`);
  return fs.existsSync(local) ? local : path.join(RESULTS_DIR, `${label}.json`);
}
const args = process.argv.slice(2);
const argValue = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

const CONFIDENCE_ORDER = ["insufficient", "conflicting", "indirect", "limited", "low", "moderate", "moderate_high", "high"];
const SAFETY_TEXT = /(urgent|urgencia|urgente|emergenc|derivaci[oó]n (inmediata|urgente|médica)|evaluaci[oó]n m[eé]dica (urgente|inmediata)|atenci[oó]n m[eé]dica (urgente|inmediata)|seek (urgent|immediate) medical|immediate medical)/i;
const NO_DIRECT_TEXT = /(no (se )?(encontr|recuper|identific)\w* (estudios|comparaciones|evidencia) (que )?(compar|direct)|sin comparaciones directas|no direct(ly)? compar|no head-to-head|no se encontraron comparaciones directas)/i;
const INSUFFICIENT_TEXT = /(no permite responder|insufficient evidence|evidencia (recuperada )?insuficiente|does not allow (a )?(confident|reliable) answer)/i;

function normTitle(title = "") {
  return String(title)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\b(revision|update|clinical practice guidelines?|a clinical practice guideline|guideline|guidelines)\b/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(title) {
  return new Set(normTitle(title).split(" ").filter((t) => t.length > 2));
}

function jaccard(a, b) {
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union ? inter / union : 0;
}

// Near-duplicate groups: identical DOI/PMID, or titles whose token sets overlap >= 0.75.
function duplicateGroups(items = []) {
  const groups = [];
  const used = new Set();
  items.forEach((a, i) => {
    if (used.has(i)) return;
    const group = [i];
    items.forEach((b, j) => {
      if (j <= i || used.has(j)) return;
      const sameId = (a.doi && b.doi && a.doi.toLowerCase() === b.doi.toLowerCase()) || (a.pmid && b.pmid && String(a.pmid) === String(b.pmid));
      if (sameId || jaccard(tokenSet(a.title), tokenSet(b.title)) >= 0.75) group.push(j);
    });
    if (group.length > 1) {
      group.forEach((k) => used.add(k));
      groups.push(group.map((k) => (items[k].title || "").slice(0, 80)));
    }
  });
  return groups;
}

function topConditionOk(exp, title = "") {
  if (!new RegExp(exp.topMustNotMatch, "i").test(title || "")) return true;
  return Boolean(exp.topAllowedIf && new RegExp(exp.topAllowedIf, "i").test(title || ""));
}

function comparisonHits(items, spec) {
  if (!spec) return null;
  const a = new RegExp(spec.a, "i");
  const b = new RegExp(spec.b, "i");
  return items.filter((it) => {
    const text = `${it.title || ""} ${it.abstract || ""}`;
    return a.test(text) && b.test(text);
  }).length;
}

function confidenceKey(payload) {
  const c = payload?.confidence || payload?.structuredResponse?.confidence || {};
  return String(c.level_key || c.levelKey || c.level || "").toLowerCase().replace(/[\s-]+/g, "_") || null;
}

function summarizeItem(it, i) {
  return {
    rank: i + 1,
    title: (it.title || "").slice(0, 110),
    year: it.year || null,
    study_type: it.study_type || null,
    source: it.retrieval_source_name || it.source_name || null,
    library: Boolean(it.library_resource),
    evidence: it.openphysio_evidence_score ?? null,
    relevance: it.query_relevance_score ?? null,
    reading: it.reading_priority_score ?? null,
    tier: it.clinical_match?.tier || null,
    match: it.clinical_match ? { components: it.clinical_match.components, match_score: it.clinical_match.match_score, rank_score: it.clinical_match.rank_score, reasons: it.clinical_match.reasons } : null,
  };
}

async function login(env) {
  const r = await fetch(`${env.BENCH_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env.BENCH_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: env.BENCH_EMAIL, password: env.BENCH_PASSWORD }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(`benchmark login failed: ${r.status}`);
  return d.access_token;
}

async function call(env, token, pathName, body, key) {
  const started = Date.now();
  const r = await fetch(`${env.BENCH_API_ROOT}${pathName}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  const payload = await r.json().catch(() => ({}));
  return { status: r.status, ms: Date.now() - started, payload };
}

function evaluate(mode, c, res) {
  const p = res.payload || {};
  const items = mode === "chat" ? p.sources || [] : p.articles || [];
  const top = items[0] || {};
  const text = mode === "chat" ? String(p.reply || "") : JSON.stringify(p.structuredResponse || {}) + String(p.reply || "");
  const directComparisonFlag = items.slice(0, 10).filter((it) => it.clinical_match?.direct_comparison).length;
  const intent = p.searchStrategy || {};
  const exp = c.expect || {};
  const checks = {};

  checks.library_top = Boolean(top.library_resource);
  if (exp.topMustNotMatch) checks.top_condition_ok = topConditionOk(exp, top.title);
  if (exp.comparison) {
    const direct = comparisonHits(items.slice(0, 10), exp.comparison);
    checks.direct_comparison_items = direct;
    checks.direct_comparison_flagged = directComparisonFlag;
    const stated = Boolean(p.comparison?.direct === false || p.comparisonAssessment?.direct === false || NO_DIRECT_TEXT.test(text));
    checks.states_no_direct_comparison = stated;
    if (exp.expectNoDirectComparisonStatement) checks.no_direct_handled = stated || direct > 0;
  }
  // What the search actually used: the parsed standalone query and condition.
  if (exp.followUpContext) checks.follow_up_context_used = new RegExp(exp.followUpContext, "i").test(`${intent.normalized_query || ""} ${intent.condition || ""}`);
  if (exp.redFlag !== undefined) checks.red_flag_route = Boolean(p.safety?.status === "red_flag" || p.safety?.redFlag === true || SAFETY_TEXT.test(text));
  if (exp.confidenceMax) {
    const k = confidenceKey(p);
    checks.confidence_within_max = k ? CONFIDENCE_ORDER.indexOf(k) <= CONFIDENCE_ORDER.indexOf(exp.confidenceMax) || !CONFIDENCE_ORDER.includes(k) : null;
  }
  if (exp.expectedQuestionType) checks.question_type_ok = String(intent.question_type || "").toLowerCase() === exp.expectedQuestionType;
  checks.insufficient_statement = INSUFFICIENT_TEXT.test(text);
  const dups = mode === "research" ? duplicateGroups(items) : [];
  checks.duplicate_groups = dups.length;

  return {
    status: res.status,
    latency_ms: res.ms,
    intent: {
      normalized_query: intent.normalized_query || null,
      question_type: intent.question_type || null,
      condition: intent.condition || null,
      population: intent.population || null,
      intervention: intent.intervention || null,
      comparator: intent.comparator || null,
      outcome: intent.outcome || null,
      body_region: intent.body_region || null,
    },
    evidence_query: mode === "chat" ? String(p.evidenceQuery || "").slice(0, 300) : null,
    search_strategy: process.env.BENCH_FULL_STRATEGY ? p.searchStrategy || null : undefined,
    confidence: { key: confidenceKey(p), score: (p.confidence || {}).score ?? null, metrics: (p.confidence || {}).metrics || null },
    consistency: mode === "research" ? (p.structuredResponse || {}).consistency_level || null : null,
    uncertainties: mode === "research" ? ((p.structuredResponse || {}).uncertainties || []).length : null,
    safety: p.safety || null,
    comparison: p.comparison || p.comparisonAssessment || null,
    counts: { items: items.length, retrieved: p.retrieved_evidence_count ?? null },
    // External database requests (Research exposes per-source diagnostics).
    source_requests: Array.isArray(p.sourceDiagnostics)
      ? p.sourceDiagnostics.map((d) => ({ source: d.source, requests: d.requests ?? null, retrieved: d.retrieved_count ?? null }))
      : null,
    top: items.slice(0, 5).map(summarizeItem),
    duplicate_groups: dups,
    reply_length: String(p.reply || "").length,
    reply_full: mode === "chat" ? String(p.reply || "") : null,
    research_full: mode === "research" ? p.structuredResponse || null : null,
    source_count: items.length,
    research_referral: mode === "chat" ? p.researchReferral?.query || null : null,
    library_labels: items.filter((it) => it.library_resource).map((it) => it.guideline_applicability || it.library_resource?.applicability || null),
    evidence_audit: p.evidenceAudit || null,
    sufficiency_detail: p.evidenceSufficiency || null,
    follow_ups: (p.followUpOptions || []).map((f) => f.prompt || f.label),
    outcome: p.outcome || null,
    sufficiency: p.evidenceSufficiency?.status || null,
    research_shape: mode === "research" ? {
      findings: ((p.structuredResponse || {}).key_findings || []).length,
      relationships: ((p.structuredResponse || {}).evidence_relationships || []).length,
      uncertainties: ((p.structuredResponse || {}).uncertainties || []).length,
      consistency: (p.structuredResponse || {}).consistency_level || null,
      caution: (p.structuredResponse || {}).methodological_caution || null,
    } : null,
    reply_excerpt: mode === "chat" ? String(p.reply || "").slice(0, 600) : (JSON.stringify((p.structuredResponse || {}).key_findings || []).slice(0, 600)),
    checks,
    error: res.status >= 400 ? p.code || p.error || null : null,
  };
}

async function ledger(env, label) {
  if (!env.BENCH_SERVICE_KEY) return [];
  const r = await fetch(`${env.BENCH_SUPABASE_URL}/rest/v1/usage_reservations?select=tool,status,ai_calls,cost_usd,created_at,committed_at,idempotency_key&idempotency_key=like.bench-${label}-*`, {
    headers: { apikey: env.BENCH_SERVICE_KEY, Authorization: `Bearer ${env.BENCH_SERVICE_KEY}` },
  });
  return r.ok ? r.json() : [];
}

async function run() {
  const env = process.env;
  const label = argValue("--label") || `run-${Date.now()}`;
  const only = argValue("--only") ? new Set(argValue("--only").split(",")) : null;
  let token = await login(env);
  let tokenAt = Date.now();
  const results = [];
  for (const c of CASES) {
    if (only && !only.has(c.id)) continue;
    for (const mode of c.modes) {
      if (Date.now() - tokenAt > 40 * 60 * 1000) { token = await login(env); tokenAt = Date.now(); }
      const key = `bench-${label}-${c.id}-${mode}-${Date.now()}`;
      let res;
      try {
        res = mode === "chat"
          ? await call(env, token, "/chat/evidence-answer", { question: c.question, messages: c.messages || [], filters: {}, limit: 8 }, key)
          : await call(env, token, "/research/search", { query: c.question, filters: c.filters || {} }, key);
      } catch (error) {
        // A timeout or network error is recorded as a failed case, not a crashed run.
        res = { status: 0, ms: 180000, payload: { code: error?.name || "request_failed" } };
      }
      const record = { id: c.id, mode, tags: c.tags, question: c.question, ...evaluate(mode, c, res) };
      results.push(record);
      console.log(`${c.id.padEnd(34)} ${mode.padEnd(8)} ${res.status} ${String(res.ms).padStart(6)}ms ${JSON.stringify(record.checks)}`);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 15000)); // let background AI calls record their cost
  const rows = await ledger(env, label);
  const byTool = (tool) => rows.filter((r) => r.tool === tool && r.status === "committed");
  const stat = (tool) => {
    const r = byTool(tool);
    const cost = r.reduce((s, x) => s + Number(x.cost_usd || 0), 0);
    const lat = r.map((x) => (Date.parse(x.committed_at) - Date.parse(x.created_at)) / 1000).sort((a, b) => a - b);
    return { ops: r.length, avg_cost_usd: r.length ? +(cost / r.length).toFixed(5) : null, avg_ai_calls: r.length ? +(r.reduce((s, x) => s + Number(x.ai_calls || 0), 0) / r.length).toFixed(2) : null, p50_s: lat.length ? +lat[Math.floor(lat.length / 2)].toFixed(1) : null, max_s: lat.length ? +lat[lat.length - 1].toFixed(1) : null };
  };
  const out = { label, created_at: new Date().toISOString(), cost_latency: { chat: stat("chat"), research: stat("research") }, results };
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUNS_DIR, `${label}.json`), JSON.stringify(out, null, 2));
  console.log(`\nsaved benchmarks/clinical/runs/${label}.json`, JSON.stringify(out.cost_latency));
}

function compare(a, b) {
  const load = (l) => JSON.parse(fs.readFileSync(runFile(l), "utf8"));
  const A = load(a); const B = load(b);
  const idx = (r) => `${r.id}|${r.mode}`;
  const bMap = new Map(B.results.map((r) => [idx(r), r]));
  for (const ra of A.results) {
    const rb = bMap.get(idx(ra));
    if (!rb) continue;
    const changes = Object.keys({ ...ra.checks, ...rb.checks })
      .filter((k) => JSON.stringify(ra.checks[k]) !== JSON.stringify(rb.checks[k]))
      .map((k) => `${k}: ${JSON.stringify(ra.checks[k])} -> ${JSON.stringify(rb.checks[k])}`);
    const topA = ra.top[0]?.title?.slice(0, 50); const topB = rb.top[0]?.title?.slice(0, 50);
    console.log(`${ra.id.padEnd(34)} ${ra.mode.padEnd(8)} ${changes.join("; ") || "(no check changes)"}${topA !== topB ? ` | top: "${topA}" -> "${topB}"` : ""}`);
  }
  console.log("cost/latency before", JSON.stringify(A.cost_latency), "\ncost/latency after ", JSON.stringify(B.cost_latency));
}

// Re-applies the current case rules to a saved run (checks that only need
// the stored titles and parsed intent).
function rescore(label) {
  const file = runFile(label);
  const run = JSON.parse(fs.readFileSync(file, "utf8"));
  const byId = new Map(CASES.map((c) => [c.id, c]));
  for (const r of run.results) {
    const exp = byId.get(r.id)?.expect || {};
    if (exp.topMustNotMatch) r.checks.top_condition_ok = topConditionOk(exp, r.top[0]?.title);
    if (exp.followUpContext) r.checks.follow_up_context_used = new RegExp(exp.followUpContext, "i").test(`${r.intent.normalized_query || ""} ${r.intent.condition || ""}`);
  }
  fs.writeFileSync(file, JSON.stringify(run, null, 2));
  console.log(`rescored ${label}`);
}

if (args[0] === "--compare") compare(args[1], args[2]);
else if (args[0] === "--rescore") rescore(args[1]);
else run().catch((e) => { console.error(e); process.exit(1); });
