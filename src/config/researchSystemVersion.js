const RESEARCH_SYSTEM_VERSION = Object.freeze({
  algorithm_version: "1.1.1",
  ranking_version: "1.0.1",
  evidence_scoring_version: "1.0.1",
  condition_dictionary_version: "1.1.0",
  benchmark_version: "1.0.0",
  result_snapshot_version: "1.0.0",
  response_schema_version: "1.0.0",
  confidence_model_version: "1.0.1",
  prompts: Object.freeze({
    intent_parser: "1.0.0",
    research_answer: "1.1.0",
    clinical_chat: "1.1.0",
    clinical_takeaway: "1.0.0",
  }),
});

const RANKING_CONFIG = Object.freeze({
  reading_priority_weights: Object.freeze({
    query_relevance: 0.45,
    evidence_quality: 0.55,
  }),
  penalties: Object.freeze({
    protocol_or_unclear: 18,
    missing_abstract: 8,
    editorial_or_correction: 25,
  }),
});

function getResearchSystemMetadata() {
  return {
    ...RESEARCH_SYSTEM_VERSION,
    prompts: { ...RESEARCH_SYSTEM_VERSION.prompts },
    ranking_config: {
      reading_priority_weights: {
        ...RANKING_CONFIG.reading_priority_weights,
      },
      penalties: { ...RANKING_CONFIG.penalties },
    },
  };
}

module.exports = {
  RESEARCH_SYSTEM_VERSION,
  RANKING_CONFIG,
  getResearchSystemMetadata,
};
