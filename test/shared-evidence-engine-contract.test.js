const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("research and chat routes use the shared evidence engine", () => {
  const researchRoute = read("src/routes/research.js");
  const chatRoute = read("src/routes/chat.js");

  assert.equal(researchRoute.includes("evidenceSearchEngine"), true);
  assert.equal(chatRoute.includes("evidenceSearchEngine"), true);
  assert.equal(researchRoute.includes("searchEvidence("), true);
  assert.equal(chatRoute.includes("searchEvidence("), true);
});

test("chat route does not contain a second retrieval pipeline", () => {
  const chatRoute = read("src/routes/chat.js");
  const duplicatedNames = [
    "searchEuropePmc",
    "searchOpenAlex",
    "searchCrossref",
    "searchPubMed",
    "rankArticles",
    "normalizeArticle",
  ];

  for (const name of duplicatedNames) {
    assert.equal(chatRoute.includes(name), false);
  }
});

test("shared engine owns the scientific search stages", () => {
  const engine = read("src/services/evidenceSearchEngine.js");
  const capabilities = [
    "deduplicateArticles",
    "normalizeResearchFilters",
    "articleMatchesResearchFilters",
    "rankArticles",
    "getCache",
    "saveSearchSnapshot",
    "saveSearchResults",
  ];

  for (const capability of capabilities) {
    assert.equal(engine.includes(capability), true);
  }
});
