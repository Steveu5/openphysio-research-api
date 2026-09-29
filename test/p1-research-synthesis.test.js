const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const deepseekPath = path.join(__dirname, "../src/services/deepseek.js");
let modelOutput = "";
let lastSystemPrompt = "";
require.cache[require.resolve(deepseekPath)] = {
  id: deepseekPath,
  filename: deepseekPath,
  loaded: true,
  exports: { callDeepSeek: async (messages) => { lastSystemPrompt = messages[0].content; return modelOutput; } },
};
const { generateStructuredResearchAnswer } = require("../src/services/structuredEvidenceResponse");

const articles = [
  { title: "Trial A", abstract: "Exercise reduced pain.", evidence_level_rank: 7 },
  { title: "Trial B", abstract: "Exercise did not reduce pain.", evidence_level_rank: 7 },
];
const intent = { language: "es" };

test("the synthesis prompt no longer forces a fixed number of findings or uncertainties", async () => {
  modelOutput = JSON.stringify({ key_findings: [{ text: "Resultados divergentes entre ensayos.", source_indices: [1, 2] }], consistency_level: "low", uncertainties: [] });
  await generateStructuredResearchAnswer({ originalQuery: "ejercicio", intent, articles });
  assert.match(lastSystemPrompt, /key_findings: 1 to 5/);
  assert.match(lastSystemPrompt, /uncertainties: 0 to 3/);
  assert.match(lastSystemPrompt, /An empty array is correct when none is relevant/);
  assert.match(lastSystemPrompt, /consistent/);
  assert.match(lastSystemPrompt, /mixed/);
  assert.match(lastSystemPrompt, /conflicting/);
  assert.match(lastSystemPrompt, /insufficient to judge/);
  assert.doesNotMatch(lastSystemPrompt, /3 to 5 distinct/);
  assert.match(lastSystemPrompt, /do not prescribe treatment/);
});

test("zero uncertainties, a single finding and any consistency level are kept as given", async () => {
  modelOutput = JSON.stringify({ key_findings: [{ text: "Los dos ensayos muestran resultados opuestos.", source_indices: [1, 2] }], consistency_level: "low", uncertainties: [] });
  const result = await generateStructuredResearchAnswer({ originalQuery: "ejercicio", intent, articles });
  assert.equal(result.structured.uncertainties.length, 0);
  assert.equal(result.structured.key_findings.length, 1);
  assert.equal(result.structured.consistency_level, "low");
  assert.deepEqual(result.structured.key_findings[0].source_indices, [1, 2]);

  modelOutput = JSON.stringify({ key_findings: [{ text: "Un único ensayo pequeño.", source_indices: [1] }], consistency_level: "uncertain", uncertainties: ["Solo un ensayo."] });
  const insufficient = await generateStructuredResearchAnswer({ originalQuery: "ejercicio", intent, articles });
  assert.equal(insufficient.structured.consistency_level, "uncertain");
  assert.equal(insufficient.structured.uncertainties.length, 1);
});

test("source indices outside the retrieved studies are dropped", async () => {
  modelOutput = JSON.stringify({ key_findings: [{ text: "Hallazgo.", source_indices: [1, 9] }], consistency_level: "high" });
  const result = await generateStructuredResearchAnswer({ originalQuery: "ejercicio", intent, articles });
  assert.deepEqual(result.structured.key_findings[0].source_indices, [1]);
});

test("the consistency enum read by P0 confidence is unchanged", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/services/structuredEvidenceResponse.js"), "utf8");
  assert.match(source, /\["high", "moderate", "low", "uncertain"\]\.includes/);
  const confidence = fs.readFileSync(path.join(__dirname, "../src/services/evidenceConfidence.js"), "utf8");
  assert.match(confidence, /\["consistent", "high", "moderate"\]\.includes\(key\)/);
});
