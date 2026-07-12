const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  isNcbiUrl,
  ncbiMinimumIntervalMs,
} = require("../src/utils/fetchWithRetry");
const {
  buildJosptGuidelineQueries,
} = require("../src/services/josptGuidelineSearch");
const {
  buildPreferredGuidelineQueries,
} = require("../src/services/preferredGuidelineSearch");

test("NCBI requests are recognized and throttled without an API key", () => {
  const previous = process.env.NCBI_API_KEY;
  delete process.env.NCBI_API_KEY;

  try {
    assert.equal(
      isNcbiUrl("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"),
      true
    );
    assert.equal(isNcbiUrl("https://example.com"), false);
    assert.ok(ncbiMinimumIntervalMs() >= 334);
  } finally {
    if (previous === undefined) delete process.env.NCBI_API_KEY;
    else process.env.NCBI_API_KEY = previous;
  }
});

test("NCBI retries honor retry-after and use a host queue", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/utils/fetchWithRetry.js"),
    "utf8"
  );

  assert.match(source, /hostQueues/);
  assert.match(source, /retry-after/);
  assert.match(source, /queuedFetch/);
  assert.match(source, /429/);
});

test("targeted JOSPT searches are limited to two sequential queries", () => {
  const queries = buildJosptGuidelineQueries(
    {
      condition: "low back pain",
      normalized_query: "chronic low back pain exercise",
      search_terms: ["low back pain"],
    },
    "Dolor lumbar crónico y ejercicio"
  );

  assert.ok(queries.length <= 2);

  const source = fs.readFileSync(
    path.join(__dirname, "../src/services/josptGuidelineSearch.js"),
    "utf8"
  );
  assert.match(source, /for \(const query of queries\)/);
  assert.doesNotMatch(source, /queries\.map\(.*searchPubMed/s);
});

test("supplemental guideline queries are capped", () => {
  const queries = buildPreferredGuidelineQueries(
    {
      condition: "low back pain",
      body_region: "lumbar spine",
      normalized_query: "chronic low back pain exercise",
      search_terms: ["low back pain"],
    },
    "Dolor lumbar crónico y ejercicio"
  );

  assert.ok(queries.length <= 4);
});
