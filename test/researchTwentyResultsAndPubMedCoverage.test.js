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
  assert.match(route, /const RESEARCH_CANDIDATE_LIMIT = 28/);
  assert.match(route, /limit: RESEARCH_CANDIDATE_LIMIT/);
  assert.match(route, /displayedArticleLimit: RESEARCH_DISPLAY_LIMIT/);
  assert.match(route, /displayLimit: RESEARCH_DISPLAY_LIMIT/);
});

test("Research reserves space for relevant non-Cochrane PubMed articles", () => {
  assert.match(route, /const MIN_PUBMED_RESULTS_IF_AVAILABLE = 5/);
  assert.match(route, /ensurePubMedRepresentation/);
  assert.match(route, /minimum: MIN_PUBMED_RESULTS_IF_AVAILABLE/);
  assert.match(route, /sourceDiversity: sourceDiversitySelection\.diagnostics/);
});

test("Library guides and clinical guidelines are protected when adding PubMed coverage", () => {
  const diversity = fs.readFileSync(
    path.join(__dirname, "../src/services/sourceDiversity.js"),
    "utf8"
  );
  assert.match(diversity, /Boolean\(article\.library_resource\)/);
  assert.match(diversity, /isGuideline\(article\)/);
});

test("source diagnostics count the articles actually shown", () => {
  assert.match(route, /buildSourceDiagnostics\(\s*evidence,\s*searchRun\.diagnostics,\s*selectedArticles/s);
  assert.match(route, /Visibles indica lo que aparece entre los artículos relevantes mostrados/);
});
