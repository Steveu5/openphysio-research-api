const test = require("node:test");
const assert = require("node:assert/strict");

const {
  RESEARCH_SYSTEM_VERSION,
  RANKING_CONFIG,
  getResearchSystemMetadata,
} = require("../src/config/researchSystemVersion");

test("research system exposes explicit semantic versions", () => {
  const metadata = getResearchSystemMetadata();

  assert.match(metadata.algorithm_version, /^\d+\.\d+\.\d+$/);
  assert.match(metadata.ranking_version, /^\d+\.\d+\.\d+$/);
  assert.match(metadata.evidence_scoring_version, /^\d+\.\d+\.\d+$/);
  assert.match(metadata.condition_dictionary_version, /^\d+\.\d+\.\d+$/);
  assert.match(metadata.benchmark_version, /^\d+\.\d+\.\d+$/);

  for (const version of Object.values(metadata.prompts)) {
    assert.match(version, /^\d+\.\d+\.\d+$/);
  }
});

test("ranking weights are normalized and returned as defensive copies", () => {
  const first = getResearchSystemMetadata();
  const second = getResearchSystemMetadata();
  const weights = first.ranking_config.reading_priority_weights;

  assert.equal(
    Number((weights.query_relevance + weights.evidence_quality).toFixed(10)),
    1
  );

  first.prompts.intent_parser = "mutated";
  first.ranking_config.penalties.missing_abstract = 999;

  assert.equal(second.prompts.intent_parser, RESEARCH_SYSTEM_VERSION.prompts.intent_parser);
  assert.equal(
    second.ranking_config.penalties.missing_abstract,
    RANKING_CONFIG.penalties.missing_abstract
  );
});
