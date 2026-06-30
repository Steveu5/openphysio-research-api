const test = require("node:test");
const assert = require("node:assert/strict");

const { hashQuery } = require("../src/utils/hash");
const {
  addResearchProvenanceToParsedQuery,
  addResearchProvenanceToResponse,
} = require("../src/services/supabase");
const { getResearchSystemMetadata } = require("../src/config/researchSystemVersion");

test("query hashes are deterministic for the active research-system version", () => {
  const value = JSON.stringify({ normalizedQuery: "chronic low back pain exercise" });

  assert.equal(hashQuery(value), hashQuery(value));
  assert.notEqual(hashQuery(value), hashQuery(`${value}:different`));
  assert.match(hashQuery(value), /^[a-f0-9]{64}$/);
});

test("parsed search intent stores exact OpenPhysio provenance", () => {
  const parsed = addResearchProvenanceToParsedQuery({
    normalized_query: "knee osteoarthritis exercise",
    condition: "knee osteoarthritis",
  });

  assert.equal(parsed.normalized_query, "knee osteoarthritis exercise");
  assert.deepEqual(parsed._openphysio_system, getResearchSystemMetadata());
});

test("research responses expose exact OpenPhysio provenance", () => {
  const response = addResearchProvenanceToResponse({
    reply: "Clinical answer",
    articles: [],
  });

  assert.equal(response.reply, "Clinical answer");
  assert.deepEqual(response.researchSystem, getResearchSystemMetadata());
});

test("provenance helpers do not mutate their inputs", () => {
  const parsedInput = { condition: "neck pain" };
  const responseInput = { cached: false };

  addResearchProvenanceToParsedQuery(parsedInput);
  addResearchProvenanceToResponse(responseInput);

  assert.equal(parsedInput._openphysio_system, undefined);
  assert.equal(responseInput.researchSystem, undefined);
});
