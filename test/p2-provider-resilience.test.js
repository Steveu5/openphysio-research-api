const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { runWithProviderBudgets } = require("../src/services/providerBudget");
const { runWithSourceDiagnostics, mergeStatus } = require("../src/services/sourceDiagnosticsContext");
const { fetchWithBudget } = require("../src/utils/fetchWithRetry");
const { searchEuropePmc, enrichArticlesWithEuropePmcMetadata, normalizeEuropePmcResult } = require("../src/services/europePmc");
const { searchCrossref } = require("../src/services/crossref");
const { searchPubMed } = require("../src/services/pubmed");
const { summarizeRetrieval, isCacheableRetrieval } = require("../src/services/retrievalStatus");
const { buildRetrievalDegradedChatStructure, buildRetrievalDegradedResearchAnswer } = require("../src/services/retrievalDegraded");

// ---- fake network ---------------------------------------------------------
const calls = [];
let handlers = {};
function abortError() { return Object.assign(new Error("aborted"), { name: "AbortError" }); }
function hang(init) {
  return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(abortError())));
}
function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}
// Headers arrive, the body never finishes (until aborted).
function hangingBody(init) {
  const stream = new ReadableStream({
    start(controller) { init.signal?.addEventListener("abort", () => controller.error(abortError())); },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
}
function providerOf(url) {
  if (url.includes("ebi.ac.uk")) return "europe_pmc";
  if (url.includes("crossref.org")) return "crossref";
  if (url.includes("esearch")) return "pubmed_search";
  if (url.includes("efetch")) return "pubmed_fetch";
  return "other";
}
global.fetch = async (url, init = {}) => {
  const p = providerOf(String(url));
  calls.push({ p, url: String(url), at: Date.now() });
  const handler = handlers[p];
  if (!handler) throw new Error(`unexpected request to ${p}`);
  return handler(init, String(url));
};
const count = (p) => calls.filter((c) => c.p === p).length;

const EPMC_OK = { resultList: { result: [{ id: "1", source: "MED", pmid: "111", title: "Exercise for tendinopathy: a randomized trial", abstractText: "Exercise reduced pain.", journalInfo: { journal: { title: "J Physio" }, yearOfPublication: 2020 }, pubYear: "2020", doi: "10.1/epmc" }] } };
const CROSSREF_OK = { message: { items: [{ title: ["Exercise for tendinopathy"], DOI: "10.1002/14651858.CD000001", "container-title": ["Cochrane Database of Systematic Reviews"], issued: { "date-parts": [[2021]] }, type: "journal-article" }] } };
const ESEARCH_EMPTY = { esearchresult: { idlist: [] } };

const BUDGETS = { europe_pmc: 400, crossref: 400, pubmed: 4000 };
const inOperation = (fn, budgets = BUDGETS) =>
  runWithSourceDiagnostics(() => runWithProviderBudgets(fn, { budgets }));
const diag = (diagnostics, source) => diagnostics.find((d) => d.source === source);
function reset(h) { calls.length = 0; handlers = h; }

test("1. healthy Europe PMC: same records as before (normalization unchanged)", async () => {
  reset({ europe_pmc: () => json(EPMC_OK) });
  const { result, diagnostics } = await inOperation(() => searchEuropePmc("exercise tendinopathy", 10, {}));
  assert.deepEqual(result.map((a) => a.title), EPMC_OK.resultList.result.map((r) => normalizeEuropePmcResult(r).title));
  assert.equal(count("europe_pmc"), 1);
  assert.equal(diag(diagnostics, "europe_pmc").status, "ok");
});

test("2. Europe PMC never answers: aborted at its budget, other providers finish, fail-open", async () => {
  let aborted = false;
  reset({
    europe_pmc: (init) => { init.signal.addEventListener("abort", () => { aborted = true; }); return hang(init); },
    crossref: () => json(CROSSREF_OK),
    pubmed_search: () => json(ESEARCH_EMPTY),
  });
  const started = Date.now();
  const { result, diagnostics } = await inOperation(() => Promise.allSettled([
    searchEuropePmc("q", 10, {}), searchCrossref("q", 10, {}), searchPubMed("q", 10, {}),
  ]));
  const elapsed = Date.now() - started;
  assert.ok(aborted, "the Europe PMC request itself was aborted");
  assert.ok(elapsed < BUDGETS.europe_pmc + 700, `bounded (${elapsed} ms)`);
  assert.equal(result[0].status, "fulfilled");
  assert.deepEqual(result[0].value, []);
  assert.ok(result[1].value.length > 0, "Crossref results kept");
  // The main search is requested once (a timeout is never retried); the only
  // other Europe PMC request is the Crossref enrichment, cut by the same
  // shared deadline.
  assert.equal(calls.filter((c) => c.p === "europe_pmc" && !/DOI|EXT_ID/.test(decodeURIComponent(c.url))).length, 1, "a timeout is never retried");
  assert.ok(count("europe_pmc") <= 2);
  const retrieval = summarizeRetrieval(diagnostics);
  assert.equal(diag(diagnostics, "europe_pmc").status, "timeout");
  assert.equal(retrieval.status, "partial");
  assert.equal(retrieval.important_failure, false, "PubMed and Crossref answered");
});

test("3. Europe PMC fast 500: one limited retry within the budget", async () => {
  let n = 0;
  reset({ europe_pmc: () => (++n === 1 ? json({}, 500) : json(EPMC_OK)) });
  const { result, diagnostics } = await inOperation(() => searchEuropePmc("q", 10, {}), { europe_pmc: 3000 });
  assert.equal(count("europe_pmc"), 2);
  assert.equal(result.length, 1);
  assert.equal(diag(diagnostics, "europe_pmc").status, "ok");
  // Persistent 500s: still at most one retry.
  reset({ europe_pmc: () => json({}, 503) });
  await inOperation(() => searchEuropePmc("q", 10, {}), { europe_pmc: 3000 });
  assert.equal(count("europe_pmc"), 2);
});

test("Retry-After is honoured only if it fits in the remaining budget", async () => {
  reset({ europe_pmc: () => json({}, 429, { "retry-after": "30" }) });
  const started = Date.now();
  await inOperation(() => searchEuropePmc("q", 10, {}), { europe_pmc: 2000 });
  assert.equal(count("europe_pmc"), 1);
  assert.ok(Date.now() - started < 1000);
});

test("a slow response body is aborted too (not only the headers)", async () => {
  reset({ europe_pmc: (init) => hangingBody(init) });
  const started = Date.now();
  const { diagnostics } = await inOperation(() => searchEuropePmc("q", 10, {}));
  assert.ok(Date.now() - started < BUDGETS.europe_pmc + 500);
  assert.equal(diag(diagnostics, "europe_pmc").status, "timeout");
});

test("4 & 12. comparison: Europe PMC main + comparison share ONE budget; PubMed comparison still runs", async () => {
  reset({ europe_pmc: (init) => hang(init), pubmed_search: () => json(ESEARCH_EMPTY) });
  const started = Date.now();
  const { result, diagnostics } = await inOperation(() => Promise.allSettled([
    searchEuropePmc("main", 10, {}),
    searchEuropePmc("A AND B", 10, {}, { branch: "comparison" }),
    searchPubMed("A AND B", 10, {}),
  ]));
  const elapsed = Date.now() - started;
  assert.ok(elapsed < BUDGETS.europe_pmc + 700, `one Europe PMC budget, not two (${elapsed} ms)`);
  assert.deepEqual(result[1].value, []);
  assert.equal(result[2].status, "fulfilled");
  assert.equal(diag(diagnostics, "pubmed").timed_out, false);
  assert.equal(diag(diagnostics, "europe_pmc").status, "timeout");
});

test("5. Europe PMC budget spent before the Crossref enrichment: enrichment skipped at once, Crossref kept", async () => {
  reset({ europe_pmc: (init) => hang(init), crossref: () => json(CROSSREF_OK) });
  // Crossref keeps its own (realistic) budget; Europe PMC's is small.
  const { result } = await inOperation(async () => {
    await searchEuropePmc("main", 10, {}); // spends the whole Europe PMC budget
    const before = count("europe_pmc");
    const started = Date.now();
    const crossref = await searchCrossref("q", 10, {});
    return { crossref, extraEuropePmcCalls: count("europe_pmc") - before, ms: Date.now() - started };
  }, { europe_pmc: 400, crossref: 5000, pubmed: 4000 });
  assert.ok(result.crossref.length > 0);
  assert.equal(result.extraEuropePmcCalls, 0, "no enrichment request once the budget is spent");
  assert.ok(result.ms < 200, `enrichment skipped immediately (${result.ms} ms)`);
});

test("6. a slow Crossref cannot block the operation", async () => {
  reset({ crossref: (init) => hang(init) });
  const started = Date.now();
  const { result, diagnostics } = await inOperation(() => searchCrossref("q", 10, {}).catch(() => "failed-open"));
  assert.ok(Date.now() - started < BUDGETS.crossref + 500);
  assert.equal(result, "failed-open");
  assert.equal(diag(diagnostics, "crossref").status, "timeout");
  assert.equal(count("crossref"), 1);
});

test("7. one provider fails, others retrieve evidence: not technical degraded", () => {
  const retrieval = summarizeRetrieval([
    { source: "pubmed", status: "ok" }, { source: "europe_pmc", status: "timeout", timed_out: true }, { source: "crossref", status: "ok" },
  ]);
  assert.equal(retrieval.status, "partial");
  assert.equal(retrieval.important_failure, false);
});

test("8. relevant providers fail: technical degraded, never 'no evidence', 0 units, no cooldown", async () => {
  for (const diagnostics of [
    [{ source: "pubmed", status: "timeout" }, { source: "europe_pmc", status: "timeout" }, { source: "crossref", status: "error" }],
    [{ source: "pubmed", status: "error" }, { source: "europe_pmc", status: "ok" }, { source: "crossref", status: "ok" }],
    [{ source: "pubmed", status: "ok" }, { source: "europe_pmc", status: "timeout" }, { source: "crossref", status: "error" }],
  ]) {
    assert.equal(summarizeRetrieval(diagnostics).important_failure, true);
  }
  const chat = buildRetrievalDegradedChatStructure("es");
  assert.match(chat.brief_answer[0].text, /no es posible saber si existe evidencia/);
  assert.doesNotMatch(chat.brief_answer[0].text, /no permite responder|no existe evidencia/);
  assert.equal(chat.degraded, true);
  const research = buildRetrievalDegradedResearchAnswer("en");
  assert.equal(research.degraded, true);
  assert.equal(research.structured.key_findings.length, 0);

  const chatRoute = fs.readFileSync(path.join(__dirname, "../src/routes/chat.js"), "utf8");
  const researchRoute = fs.readFileSync(path.join(__dirname, "../src/routes/research.js"), "utf8");
  assert.match(chatRoute, /evidenceSufficiency\.status === "insufficient" &&\s*Boolean\(retrieval\?\.important_failure\)/);
  assert.match(chatRoute, /\{ cooldown: !retrievalDegraded \}/);
  assert.match(researchRoute, /selectedArticles\.length === 0 && Boolean\(retrieval\?\.important_failure\)/);
  assert.match(researchRoute, /cooldown: !retrievalDegraded/);
});

test("8b. a technical degraded settlement releases the unit and skips the cooldown", async () => {
  const supabasePath = require.resolve("../src/services/supabase.js");
  const rpc = [];
  const original = require.cache[supabasePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: { getSupabaseAdmin: () => ({ rpc: async (name) => { rpc.push(name); return { data: { released: true }, error: null }; } }) } };
  delete require.cache[require.resolve("../src/services/usageQuota.js")];
  const { settleUsage } = require("../src/services/usageQuota.js");
  const cooldown = require("../src/services/degradedCooldown");
  cooldown.resetDegradedCooldowns();
  for (let i = 0; i < 5; i += 1) {
    const result = await settleUsage({ id: `r${i}`, tool: "chat", userId: "u-outage", periodKey: "p" }, "degraded", { cooldown: false });
    assert.equal(result.charged, false);
  }
  assert.ok(rpc.every((name) => name === "release_usage_unit"));
  assert.equal(cooldown.cooldownRemainingSeconds("u-outage", "chat"), 0, "an outage never triggers the user cooldown");
  require.cache[supabasePath] = original;
});

test("9 & 10. shared cache only for complete retrievals", () => {
  assert.equal(isCacheableRetrieval(summarizeRetrieval([{ source: "pubmed", status: "ok" }, { source: "europe_pmc", status: "empty" }, { source: "crossref", status: "ok" }])), true);
  assert.equal(isCacheableRetrieval(summarizeRetrieval([{ source: "pubmed", status: "ok" }, { source: "europe_pmc", status: "timeout" }, { source: "crossref", status: "ok" }])), false);
  assert.equal(isCacheableRetrieval(summarizeRetrieval([{ source: "pubmed", status: "partial" }, { source: "europe_pmc", status: "ok" }, { source: "crossref", status: "ok" }])), false);
  assert.equal(isCacheableRetrieval({ status: "cached" }), true);
  const researchRoute = fs.readFileSync(path.join(__dirname, "../src/routes/research.js"), "utf8");
  assert.match(researchRoute, /if \(!researchDegraded && isCacheableRetrieval\(retrieval\)\) void setCache/);
});

test("11. diagnostics: ok / timeout / partial / error and budget_ms", async () => {
  assert.equal(mergeStatus("ok", "timeout"), "partial");
  assert.equal(mergeStatus("timeout", "timeout"), "timeout");
  assert.equal(mergeStatus("error", "error"), "error");
  assert.equal(mergeStatus("ok", "ok"), "ok");

  reset({ europe_pmc: (() => { let n = 0; return (init) => (++n === 1 ? json(EPMC_OK) : hang(init)); })() });
  const { diagnostics } = await inOperation(() => Promise.all([
    searchEuropePmc("main", 10, {}),
    new Promise((r) => setTimeout(r, 20)).then(() => searchEuropePmc("A AND B", 10, {}, { branch: "comparison" })),
  ]));
  const epmc = diag(diagnostics, "europe_pmc");
  assert.equal(epmc.status, "partial");
  assert.equal(epmc.timed_out, true);
  assert.equal(epmc.requests, 2);
  assert.equal(epmc.budget_ms, BUDGETS.europe_pmc);
  assert.doesNotMatch(String(epmc.error), /at |https?:\/\//, "no stack traces or URLs");
});

test("PubMed keeps the NCBI throttle and does not retry a timed-out primary query with its fallback", async () => {
  reset({ pubmed_search: (init) => hang(init) });
  const { diagnostics } = await inOperation(() => searchPubMed("exercise AND (tendinopathy)", 10, {}).catch(() => null), { pubmed: 600 });
  assert.equal(count("pubmed_search"), 1, "no fallback query after a timeout");
  assert.equal(diag(diagnostics, "pubmed").status, "timeout");

  reset({ pubmed_search: () => json(ESEARCH_EMPTY) });
  await inOperation(() => Promise.all([searchPubMed("a", 10, {}), searchPubMed("b", 10, {})]));
  const [first, second] = calls.filter((c) => c.p === "pubmed_search");
  assert.ok(second.at - first.at >= 100, "requests are still spaced by the NCBI queue");
});

test("the search engine runs its provider fan-out inside one budgeted, diagnosed operation", () => {
  const engine = fs.readFileSync(path.join(__dirname, "../src/services/evidenceSearchEngine.js"), "utf8");
  assert.match(engine, /runWithProviderBudgets\(\(\) =>\s*Promise\.allSettled/);
  assert.match(engine, /const retrieval = summarizeRetrieval\(retrievalDiagnostics\)/);
  assert.match(engine, /_openphysio_retrieval/);
  assert.match(engine, /searchEuropePmc\(comparisonQuery, 10, normalizedFilters, \{ branch: "comparison" \}\)/);
});

test("a request stuck behind a hung NCBI queue slot still ends at its budget", async () => {
  // A misbehaving request that never settles, even when aborted, holds the
  // NCBI queue; later PubMed requests must still end at the PubMed budget.
  let first = true;
  reset({ pubmed_search: () => (first ? ((first = false), new Promise(() => {})) : json(ESEARCH_EMPTY)) });
  const started = Date.now();
  const { diagnostics } = await inOperation(
    () => Promise.allSettled([searchPubMed("a", 10, {}), searchPubMed("b", 10, {})]),
    { pubmed: 600, europe_pmc: 400, crossref: 400 }
  );
  assert.ok(Date.now() - started < 1500, `bounded by the budget (${Date.now() - started} ms)`);
  assert.equal(diag(diagnostics, "pubmed").status, "timeout");
});

test("Research sourceDiagnostics never show a timed-out provider as healthy in the current UI", () => {
  const { buildSourceDiagnostics } = require("../src/services/researchSearchSummary");
  const rows = buildSourceDiagnostics({}, [
    { source: "pubmed", status: "ok", retrieved_count: 10, requests: 6 },
    { source: "europe_pmc", status: "timeout", timed_out: true, budget_ms: 10000, requests: 2, error: "PROVIDER_TIMEOUT" },
    { source: "crossref", status: "partial", timed_out: true, requests: 2 },
  ], []);
  const epmc = rows.find((r) => r.source === "europe_pmc");
  assert.equal(epmc.status, "error");
  assert.equal(epmc.detail_status, "timeout");
  assert.equal(epmc.timed_out, true);
  assert.equal(epmc.budget_ms, 10000);
  assert.equal(epmc.consulted, true);
  assert.equal(rows.find((r) => r.source === "crossref").status, "partial");
  assert.equal(rows.find((r) => r.source === "pubmed").status, "ok");
});
