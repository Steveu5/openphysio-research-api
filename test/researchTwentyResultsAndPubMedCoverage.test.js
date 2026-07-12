const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const route = fs.readFileSync(
  path.join(__dirname, "../src/routes/research.js"),
  "utf8"
);

test("Research requests and displays up to 20 relevant articles", () => {
  assert.match(route, /const RESEARCH_DISPLAY_LIMIT = 20/);
  assert.match(route, /limit: RESEARCH_DISPLAY_LIMIT/);
  assert.match(route, /displayedArticleLimit: RESEARCH_DISPLAY_LIMIT/);
  assert.match(route, /selected\.slice\(0, displayLimit\)/);
});

test("Research reserves space for relevant non-Cochrane PubMed articles", () => {
  assert.match(route, /const MIN_PUBMED_RESULTS_IF_AVAILABLE = 5/);
  assert.match(route, /function isNonCochranePubMedArticle/);
  assert.match(route, /function ensurePubMedRepresentation/);
  assert.match(route, /!journal\.includes\("cochrane"\)/);
  assert.match(route, /pubmedMinimumIfAvailable: MIN_PUBMED_RESULTS_IF_AVAILABLE/);
});

test("Library guides and clinical guidelines are protected when adding PubMed coverage", () => {
  assert.match(route, /!isLibraryGuide\(current\)/);
  assert.match(route, /!isGuideline\(current\)/);
  assert.match(route, /prioritizeLibraryGuides/);
});

test("source diagnostics count the articles actually shown", () => {
  assert.match(route, /buildSourceDiagnostics\(\s*evidence,\s*searchRun\.diagnostics,\s*selectedArticles/s);
  assert.match(route, /seleccionados indica lo que aparece entre los artículos relevantes mostrados/);
});
