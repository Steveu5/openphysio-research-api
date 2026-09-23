#!/usr/bin/env node
// Controlled AI cost measurement against a running API (local or production).
// Sends fictitious clinical questions (no patient data) as an authorized
// test account, validates citations, and prints per-response checks. The
// cost itself is read from the server's `ai_operation` log lines; pass the
// server log file with --log to join both.
//
// Usage:
//   MEASURE_API_ROOT=http://127.0.0.1:3000 MEASURE_ACCESS_TOKEN=<jwt> \
//     node tools/measure-ai-cost.js --log server.log [--budget 0.8]

const fs = require("node:fs");

const apiRoot = (process.env.MEASURE_API_ROOT || "http://127.0.0.1:3000").replace(/\/$/, "");
const token = process.env.MEASURE_ACCESS_TOKEN;
const args = process.argv.slice(2);
const logFile = args.includes("--log") ? args[args.indexOf("--log") + 1] : null;
const budgetUsd = Number(args.includes("--budget") ? args[args.indexOf("--budget") + 1] : 0.8);

const LONG_QUESTION = [
  "Caso ficticio con fines docentes: mujer de 62 años con artrosis de rodilla bilateral,",
  "dolor mecánico de 4/10 al subir escaleras, rigidez matinal breve y sobrepeso leve.",
  "Quiero un razonamiento completo: 1) qué intervenciones tienen mejor respaldo (ejercicio,",
  "educación, control de peso, terapia manual, ayudas técnicas), 2) cómo dosificar el ejercicio",
  "de fortalecimiento y aeróbico en las primeras 12 semanas, 3) qué factores de evaluación",
  "modifican el plan, 4) qué precauciones y señales de alarma vigilar, y 5) qué resultados",
  "funcionales medir para evaluar la progresión.",
].join(" ");

const CHAT_CASES = [
  { id: "chat_greeting", size: "greeting", question: "Hola" },
  { id: "chat_short_es", size: "short", question: "¿El ejercicio excéntrico ayuda en la tendinopatía aquílea?" },
  {
    id: "chat_normal_es",
    size: "normal",
    question:
      "Caso ficticio: adulto de 45 años con dolor lumbar crónico inespecífico. ¿Qué enfoque de ejercicio terapéutico respalda la evidencia?",
  },
  {
    id: "chat_normal_en",
    size: "normal",
    question: "What does the evidence say about exercise therapy for rotator cuff tendinopathy?",
  },
  { id: "chat_long_es", size: "long", question: LONG_QUESTION },
  {
    id: "chat_followup_es",
    size: "follow_up",
    followUpOf: "chat_normal_es",
    question: "¿Y cómo progresarías la carga durante las primeras 6 semanas?",
  },
];

const RESEARCH_CASES = [
  { id: "research_lbp_es", query: "ejercicio terapéutico en dolor lumbar crónico" },
  { id: "research_neck_en", query: "manual therapy for chronic neck pain" },
  { id: "research_acl_en", query: "anterior cruciate ligament injury prevention programs" },
];

async function post(path, body) {
  const started = Date.now();
  const response = await fetch(`${apiRoot}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload, ms: Date.now() - started };
}

// Every [n] / source index in the answer must point to a returned source,
// and every returned source must come with a verifiable identifier.
function citationCheck(text, sources, structuredIndices) {
  const cited = [...String(text || "").matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  const indices = [...new Set([...cited, ...structuredIndices])];
  const outOfRange = indices.filter((n) => n < 1 || n > sources.length);
  const unverifiable = sources.filter((s) => !(s.doi || s.url || s.source_url || s.pmid || s.library_resource));
  return {
    cited_indices: indices.sort((a, b) => a - b),
    sources: sources.length,
    out_of_range: outOfRange,
    sources_without_identifier: unverifiable.length,
    ok: outOfRange.length === 0 && unverifiable.length === 0,
  };
}

function collectIndices(value, acc = []) {
  if (Array.isArray(value)) value.forEach((v) => collectIndices(v, acc));
  else if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      if (key === "source_indices" && Array.isArray(v)) acc.push(...v.map(Number));
      else collectIndices(v, acc);
    }
  }
  return acc;
}

function spentSoFar() {
  if (!logFile || !fs.existsSync(logFile)) return 0;
  return fs
    .readFileSync(logFile, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("{\"type\":\"ai_call\""))
    .reduce((sum, line) => {
      try {
        return sum + (JSON.parse(line).cost_usd || 0);
      } catch {
        return sum;
      }
    }, 0);
}

async function main() {
  const results = [];
  const answers = {};

  const unauth = await fetch(`${apiRoot}/chat/evidence-answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "test" }),
  });
  results.push({ id: "access_unauthenticated_chat", status: unauth.status, ok: unauth.status === 401 });

  for (const c of CHAT_CASES) {
    if (spentSoFar() >= budgetUsd) {
      results.push({ id: c.id, skipped: "budget" });
      continue;
    }
    const messages = c.followUpOf && answers[c.followUpOf]
      ? [
          { role: "user", content: answers[c.followUpOf].question },
          { role: "assistant", content: answers[c.followUpOf].reply },
        ]
      : [];
    const { status, payload, ms } = await post("/chat/evidence-answer", {
      question: c.question,
      messages,
      filters: {},
      limit: 4,
    });
    answers[c.id] = { question: c.question, reply: payload.reply || "" };
    results.push({
      id: c.id,
      kind: "chat",
      size: c.size,
      status,
      ms,
      reply_chars: (payload.reply || "").length,
      quota: payload.quota ? { used: payload.quota.used ?? payload.quota.used_count, limit: payload.quota.limit ?? payload.quota.limit_count } : null,
      citations: payload.sources ? citationCheck(payload.reply, payload.sources, collectIndices(payload.structuredResponse)) : null,
      error: status >= 400 ? payload.code || payload.error : null,
    });
  }

  for (const r of RESEARCH_CASES) {
    if (spentSoFar() >= budgetUsd) {
      results.push({ id: r.id, skipped: "budget" });
      continue;
    }
    const { status, payload, ms } = await post("/research/search", { query: r.query, filters: {} });
    results.push({
      id: r.id,
      kind: "research",
      status,
      ms,
      articles: Array.isArray(payload.articles) ? payload.articles.length : 0,
      key_findings: payload.structuredResponse?.key_findings?.length || 0,
      citations: Array.isArray(payload.articles)
        ? citationCheck(payload.reply, payload.articles, collectIndices(payload.structuredResponse))
        : null,
      error: status >= 400 ? payload.code || payload.error : null,
    });
  }

  fs.writeFileSync(process.env.MEASURE_OUT || require("node:path").join(require("node:os").tmpdir(), "measure-results.json"), JSON.stringify({ results, answers }, null, 2));
  console.log(JSON.stringify(results, null, 2));
  console.log(`AI spend recorded so far: $${spentSoFar().toFixed(5)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
