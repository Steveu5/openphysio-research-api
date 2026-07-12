const RESEARCH_SYSTEM_VERSION = Object.freeze({
  algorithm_version: "1.2.1",
  ranking_version: "1.3.0",
  evidence_scoring_version: "1.0.1",
  condition_dictionary_version: "1.1.1",
  benchmark_version: "1.0.0",
  result_snapshot_version: "1.0.0",
  response_schema_version: "1.2.0",
  confidence_model_version: "1.1.1",
  evidence_selection_version: "1.2.0",
  research_result_quality_version: "1.1.0",
  research_search_summary_version: "1.1.0",
  research_answer_safety_version: "1.1.0",
  source_priority_version: "1.1.0",
  targeted_jospt_search_version: "1.1.0",
  related_cervical_guideline_version: "1.0.0",
  library_guide_integration_version: "1.0.0",
  library_region_matching_version: "1.0.0",
  research_referral_version: "1.0.0",
  chat_claim_safety_version: "1.0.0",
  prompts: Object.freeze({
    intent_parser: "1.0.0",
    research_answer: "1.2.0",
    clinical_chat: "1.1.0",
    clinical_takeaway: "1.0.0",
  }),
});

const RANKING_CONFIG = Object.freeze({
  reading_priority_weights: Object.freeze({
    query_relevance: 0.45,
    evidence_quality: 0.55,
  }),
  preferred_source_order: Object.freeze([
    "library_jospt_guideline",
    "jospt_guideline",
    "apta_aopt_guideline",
    "other_guideline",
    "cochrane_review",
    "pubmed_evidence",
    "other_evidence",
  ]),
  penalties: Object.freeze({
    protocol_or_unclear: 18,
    missing_abstract: 8,
    editorial_or_correction: 25,
    population_mismatch: 40,
    stage_mismatch: 35,
    highly_indirect: 20,
    specific_context_for_broad_question: 7,
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
      preferred_source_order: [
        ...RANKING_CONFIG.preferred_source_order,
      ],
      penalties: { ...RANKING_CONFIG.penalties },
    },
  };
}

module.exports = {
  RESEARCH_SYSTEM_VERSION,
  RANKING_CONFIG,
  getResearchSystemMetadata,
};
