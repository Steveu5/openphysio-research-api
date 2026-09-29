const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// The model client returns whatever the test sets.
const deepseekPath = path.join(__dirname, "../src/services/deepseek.js");
let modelOutput = "";
require.cache[require.resolve(deepseekPath)] = {
  id: deepseekPath,
  filename: deepseekPath,
  loaded: true,
  exports: { callDeepSeek: async () => modelOutput },
};
const {
  generateStructuredClinicalChatAnswer,
  generateStructuredResearchAnswer,
} = require("../src/services/structuredEvidenceResponse");
const { degradedNotice } = require("../src/services/degradedResponse");

const articles = [{ title: "Exercise for patellar tendinopathy", abstract: "Exercise improved pain.", evidence_level_rank: 9 }];
const intent = { language: "es", condition: "patellar tendinopathy" };

test("Chat: invalid model output is DEGRADED and returns the fallback", async () => {
  modelOutput = "not json at all";
  const result = await generateStructuredClinicalChatAnswer({ question: "¿Ejercicio?", intent, articles });
  assert.equal(result.degraded, true);
  assert.equal(result.structured.degraded, true);
});

test("Chat: valid JSON without a direct answer is DEGRADED", async () => {
  modelOutput = JSON.stringify({ brief_answer: [], clinical_application: [] });
  const result = await generateStructuredClinicalChatAnswer({ question: "¿Ejercicio?", intent, articles });
  assert.equal(result.degraded, true);
});

test("Chat: a valid answer is SUCCESS", async () => {
  modelOutput = JSON.stringify({ brief_answer: [{ text: "El ejercicio mejora el dolor.", source_indices: [1] }] });
  const result = await generateStructuredClinicalChatAnswer({ question: "¿Ejercicio?", intent, articles });
  assert.equal(result.degraded, false);
});

test("Research: no key findings is DEGRADED; valid findings are SUCCESS", async () => {
  modelOutput = "{}";
  const degraded = await generateStructuredResearchAnswer({ originalQuery: "ejercicio tendinopatía", intent, articles });
  assert.equal(degraded.degraded, true);
  modelOutput = JSON.stringify({
    key_findings: [{ text: "El ejercicio redujo el dolor en los estudios incluidos.", source_indices: [1] }],
    consistency_level: "moderate",
  });
  const ok = await generateStructuredResearchAnswer({ originalQuery: "ejercicio tendinopatía", intent, articles });
  assert.equal(ok.degraded, false);
});

test("the degraded notice says whether the unit was counted", () => {
  assert.match(degradedNotice("es", false), /no se ha descontado/);
  assert.doesNotMatch(degradedNotice("es", true), /no se ha descontado/);
  assert.match(degradedNotice("en", false), /not counted/);
});

test("routes settle degraded answers and never cache degraded Research", () => {
  const fs = require("node:fs");
  const chat = fs.readFileSync(path.join(__dirname, "../src/routes/chat.js"), "utf8");
  const research = fs.readFileSync(path.join(__dirname, "../src/routes/research.js"), "utf8");
  assert.match(chat, /settleUsage\(\s*reservation,\s*answerDegraded \? "degraded" : "success"/);
  assert.match(research, /settleUsage\(reservation, "degraded"\)/);
  assert.match(research, /if \(!researchDegraded\) void setCache/);
  // Errors still release the unit.
  assert.match(chat, /if \(reservation\) await releaseUsage\(reservation\)/);
  assert.match(research, /if \(reservation\) await releaseUsage\(reservation\)/);
});
