const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("Research resolves the response language from the question first", () => {
  const route = read("src/routes/research.js");

  assert.match(route, /resolveResearchResponseLanguage\(\{/);
  assert.match(route, /query,/);
  assert.match(route, /requestedLanguage,/);
  assert.match(route, /responseLanguage: language/);
});

test("generated Research narratives pass through the language guard", () => {
  const generator = read("src/services/structuredEvidenceResponse.js");
  const normalization = generator.indexOf("const structured = normalizeResearchStructure");
  const languageGuard = generator.indexOf("await ensureResearchStructureLanguage");

  assert.notEqual(normalization, -1);
  assert.notEqual(languageGuard, -1);
  assert.ok(languageGuard > normalization);
  assert.match(generator, /languageGuard: aligned\.diagnostics/);
});
