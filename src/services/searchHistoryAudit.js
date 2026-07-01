const { getResearchSystemMetadata } = require("../config/researchSystemVersion");
const { rankArticles } = require("./ranking");

const VERSION_PATHS = [
  "algorithm_version",
  "ranking_version",
  "evidence_scoring_version",
  "condition_dictionary_version",
  "benchmark_version",
  "prompts.intent_parser",
  "prompts.research_answer",
  "prompts.clinical_chat",
  "prompts.clinical_takeaway",
  "ranking_config.reading_priority_weights.query_relevance",
  "ranking_config.reading_priority_weights.evidence_quality",
  "ranking_config.penalties.protocol_or_unclear",
  "ranking_config.penalties.missing_abstract",
  "ranking_config.penalties.editorial_or_correction",
];

function getPath(object, path) {
  return path.split(".").reduce(
    (value, key) => (value == null ? undefined : value[key]),
    object
  );
}

function getStoredResearchSystem(parsedQuery = {}) {
  return parsedQuery?._openphysio_system || null;
}

function stripResearchSystemFromIntent(parsedQuery = {}) {
  const { _openphysio_system: _ignored, ...intent } = parsedQuery || {};
  return intent;
}

function compareResearchSystemSnapshots(storedSystem, currentSystem = getResearchSystemMetadata()) {
  if (!storedSystem) {
    return {
      status: "legacy_unversioned",
      is_current: false,
      changed_components: ["provenance"],
      differences: [
        {
          field: "research_system",
          stored: null,
          current: currentSystem,
        },
      ],
    };
  }

  const differences = VERSION_PATHS.flatMap((field) => {
    const stored = getPath(storedSystem, field);
    const current = getPath(currentSystem, field);
    return Object.is(stored, current)
      ? []
      : [{ field, stored: stored ?? null, current: current ?? null }];
  });

  const changedComponents = Array.from(
    new Set(differences.map((difference) => difference.field.split(".")[0]))
  );

  return {
    status: differences.length ? "version_changed" : "current",
    is_current: differences.length === 0,
    changed_components: changedComponents,
    differences,
  };
}

function compareRankingPositions(originalRows = [], currentRankedArticles = []) {
  const originalById = new Map(
    originalRows
      .filter((row) => row?.article_id)
      .map((row) => [row.article_id, row])
  );
  const currentById = new Map(
    currentRankedArticles
      .filter((article) => article?.id)
      .map((article, index) => [article.id, { article, rank: index + 1 }])
  );

  const orderedIds = [
    ...originalRows.map((row) => row.article_id).filter(Boolean),
    ...currentRankedArticles
      .map((article) => article.id)
      .filter((id) => id && !originalById.has(id)),
  ];

  const items = orderedIds.map((articleId) => {
    const original = originalById.get(articleId) || null;
    const current = currentById.get(articleId) || null;
    const originalRank = original?.rank_position ?? null;
    const currentRank = current?.rank ?? null;

    let movement = "unchanged";
    let rankChange = 0;

    if (originalRank == null) {
      movement = "new";
      rankChange = null;
    } else if (currentRank == null) {
      movement = "removed";
      rankChange = null;
    } else {
      rankChange = originalRank - currentRank;
      if (rankChange > 0) movement = "up";
      if (rankChange < 0) movement = "down";
    }

    const article = current?.article || original?.research_articles || {};

    return {
      article_id: articleId,
      title: article.title || null,
      original_rank: originalRank,
      current_rank: currentRank,
      rank_change: rankChange,
      movement,
      historical_relevance_score: original?.relevance_score ?? null,
      historical_ranking_reason: original?.ranking_reason || null,
      current_relevance_score: current?.article?.relevance_score ?? null,
      current_reading_priority_score: current?.article?.reading_priority_score ?? null,
      current_query_relevance_score: current?.article?.query_relevance_score ?? null,
      current_evidence_score: current?.article?.openphysio_evidence_score ?? null,
      current_ranking_reason: current?.article?.ranking_reason || null,
    };
  });

  return {
    summary: {
      total_original: originalRows.length,
      total_current: currentRankedArticles.length,
      unchanged: items.filter((item) => item.movement === "unchanged").length,
      moved_up: items.filter((item) => item.movement === "up").length,
      moved_down: items.filter((item) => item.movement === "down").length,
      new: items.filter((item) => item.movement === "new").length,
      removed: items.filter((item) => item.movement === "removed").length,
    },
    items,
  };
}

function mapHistoricalRankingRow(row = {}) {
  const article = row.research_articles || {};
  return {
    rank: row.rank_position ?? null,
    article_id: row.article_id || article.id || null,
    title: article.title || null,
    year: article.year || null,
    journal: article.journal || null,
    study_type: article.study_type || null,
    doi: article.doi || null,
    pmid: article.pmid || null,
    source_name: article.source_name || null,
    source_url: article.source_url || null,
    historical_relevance_score: row.relevance_score ?? null,
    historical_ranking_reason: row.ranking_reason || null,
  };
}

function mapCurrentRankingArticle(article = {}, index = 0) {
  return {
    rank: index + 1,
    article_id: article.id || null,
    title: article.title || null,
    year: article.year || null,
    journal: article.journal || null,
    study_type: article.study_type || null,
    doi: article.doi || null,
    pmid: article.pmid || null,
    source_name: article.source_name || null,
    source_url: article.source_url || null,
    relevance_score: article.relevance_score ?? null,
    reading_priority_score: article.reading_priority_score ?? null,
    query_relevance_score: article.query_relevance_score ?? null,
    evidence_score: article.openphysio_evidence_score ?? null,
    ranking_reason: article.ranking_reason || null,
  };
}

function buildSearchHistoryAudit({
  queryRecord,
  resultRows = [],
  currentSystem = getResearchSystemMetadata(),
  ranker = rankArticles,
} = {}) {
  if (!queryRecord) return null;

  const parsedQuery = queryRecord.parsed_query || {};
  const storedSystem = getStoredResearchSystem(parsedQuery);
  const intent = stripResearchSystemFromIntent(parsedQuery);
  const articles = resultRows
    .map((row) => row.research_articles)
    .filter((article) => article?.id);
  const currentRankedArticles = ranker(
    articles.map((article) => ({ ...article })),
    { ...intent }
  );

  return {
    query: {
      id: queryRecord.id,
      query_text: queryRecord.query_text,
      normalized_query: queryRecord.normalized_query || null,
      query_language: queryRecord.query_language || null,
      created_at: queryRecord.created_at || null,
      intent,
    },
    provenance: {
      stored_system: storedSystem,
      current_system: currentSystem,
      comparison: compareResearchSystemSnapshots(storedSystem, currentSystem),
    },
    reproducibility: {
      level: storedSystem ? "partial" : "limited",
      system_snapshot_preserved: Boolean(storedSystem),
      article_set_preserved: true,
      historical_positions_preserved: true,
      immutable_article_metadata_snapshot_preserved: false,
      comparison_scope: "same_saved_article_set_with_current_article_metadata",
      limitation:
        "The original article set and rank positions are preserved, but re-ranking uses the current research_articles metadata rather than an immutable metadata snapshot from the original search.",
    },
    original_ranking: resultRows.map(mapHistoricalRankingRow),
    current_ranking: currentRankedArticles.map(mapCurrentRankingArticle),
    ranking_comparison: compareRankingPositions(resultRows, currentRankedArticles),
  };
}

module.exports = {
  VERSION_PATHS,
  getPath,
  getStoredResearchSystem,
  stripResearchSystemFromIntent,
  compareResearchSystemSnapshots,
  compareRankingPositions,
  mapHistoricalRankingRow,
  mapCurrentRankingArticle,
  buildSearchHistoryAudit,
};
