const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getConditionConceptGroups,
  getConditionMatch,
} = require("../src/services/conditionConcepts");
const { normalizeArticle } = require("../src/services/normalize");
const {
  buildCochraneSearchUrl,
} = require("../src/services/cochraneCrossref");
const {
  identifySource,
} = require("../src/middleware/sourceDiagnostics");

test("combined neck pain and headache intent resolves both clinical concepts", () => {
  const groups = getConditionConceptGroups({
    condition: "neck pain and headache",
    body_region: "cervical spine and head",
  });

  const ids = groups.map((group) => group.id);
  assert.ok(ids.includes("neck_pain"));
  assert.ok(ids.includes("headache"));
});

test("cervicogenic headache evidence is retained for a neck and headache query", () => {
  const match = getConditionMatch(
    {
      title: "Physical therapy for cervicogenic headache and associated neck pain",
      abstract:
        "This systematic review evaluated exercise and manual therapy for cervicogenic headache.",
    },
    {
      condition: "neck pain and headache",
      body_region: "cervical spine",
    }
  );

  assert.equal(match.matches, true);
  assert.ok(match.matched_groups.includes("neck_pain"));
  assert.ok(match.matched_groups.includes("headache"));
});

test("query metadata cannot make an unrelated article appear relevant", () => {
  const match = getConditionMatch(
    {
      title: "Exercise for knee osteoarthritis",
      abstract: "A review of strengthening for knee pain.",
      condition: "neck pain and headache",
      body_region: "cervical spine",
    },
    {
      condition: "neck pain and headache",
      body_region: "cervical spine",
    }
  );

  assert.equal(match.matches, false);
  assert.equal(match.matched_count, 0);
});

test("article normalization keeps query intent separate from article facts", () => {
  const normalized = normalizeArticle(
    {
      title: "A clinical review",
      abstract: "The article discusses headache management.",
      source_name: "PubMed",
    },
    {
      condition: "neck pain and headache",
      intervention: "exercise",
      population: "adults",
    }
  );

  assert.equal(normalized.condition, null);
  assert.equal(normalized.intervention, null);
  assert.equal(normalized.population, null);
  assert.equal(
    normalized.raw_metadata.query_context.condition,
    "neck pain and headache"
  );
});

test("Cochrane metadata query uses the current Crossref v1 endpoint without fragile select fields", () => {
  const url = buildCochraneSearchUrl("neck pain headache", 10, {});

  assert.equal(url.origin, "https://api.crossref.org");
  assert.equal(url.pathname, "/v1/works");
  assert.equal(
    url.searchParams.get("query.container-title"),
    "Cochrane Database of Systematic Reviews"
  );
  assert.equal(url.searchParams.has("select"), false);
});

test("source diagnostics identify OpenAlex and describe Cochrane transport accurately", () => {
  const openAlex = identifySource("https://api.openalex.org/works?search=neck+pain");
  const cochrane = identifySource(
    "https://api.crossref.org/v1/works?query.container-title=Cochrane"
  );

  assert.equal(openAlex.id, "openalex");
  assert.equal(openAlex.label, "OpenAlex");
  assert.equal(cochrane.id, "cochrane");
  assert.match(cochrane.label, /metadata vía Crossref/);
});
