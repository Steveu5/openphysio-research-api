const RANKING_ALGORITHM_VERSION = "1.1.0";
const RANKING_WEIGHTS_VERSION = "1.0.0";

const RANKING_WEIGHTS = Object.freeze({
  study_type: Object.freeze({
    evidence_rank_multiplier: 12,
  }),
  directness: Object.freeze({
    condition_and_intervention: 18,
    title_condition_and_intervention: 14,
    direct_clinical_outcome: 12,
    network_meta_analysis: 12,
    title_answers_question: 10,
    abstract_with_direct_results: 8,
    secondary_focus_title_penalty: 20,
    secondary_focus_abstract_penalty: 8,
    protocol_penalty: 45,
    combined_non_physio_penalty: 14,
    adult_population_mismatch_penalty: 24,
    older_adult_specific_penalty: 8,
    competing_condition_penalty: 14,
  }),
  reading_priority_penalties: Object.freeze({
    protocol_or_unclear: 18,
    missing_abstract: 8,
    editorial_noise: 25,
  }),
  retrieval_relevance: Object.freeze({
    abstract_available_bonus: 12,
    missing_abstract_penalty: 24,
    open_access_bonus: 4,
    search_term_match_bonus: 3,
    condition_match_bonus: 14,
    intervention_match_bonus: 14,
    population_match_bonus: 6,
    recency_max_bonus: 16,
    recency_decay_per_year: 1.2,
  }),
  reading_priority_blend: Object.freeze({
    query_relevance: 0.45,
    article_quality: 0.55,
  }),
});

module.exports = {
  RANKING_ALGORITHM_VERSION,
  RANKING_WEIGHTS_VERSION,
  RANKING_WEIGHTS,
};
