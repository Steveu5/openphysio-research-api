const {
  attachSourceDiagnostics,
} = require("./sourceDiagnostics");
const supabaseService = require("../services/supabase");
const rankingService = require("../services/ranking");
const {
  enrichArticlesWithStoredPedroScores,
} = require("../services/storedPedroScores");

const PEDRO_RANKING_VERSION = 1;
const METADATA_ENRICHMENT_VERSION = 1;

const originalRankArticles = rankingService.rankArticles;

rankingService.rankArticles = (articles, intent) =>
  originalRankArticles(
    enrichArticlesWithStoredPedroScores(articles),
    intent
  );

const originalUpsertArticles = supabaseService.upsertArticles;

supabaseService.upsertArticles = async (articles) => {
  const savedArticles = await originalUpsertArticles(articles);

  return savedArticles.map((savedArticle, index) => {
    const runtimeArticle = articles[index] || {};

    return {
      ...savedArticle,
      pedro_score: runtimeArticle.pedro_score,
      pedro_score_label: runtimeArticle.pedro_score_label,
      pedro_score_status: runtimeArticle.pedro_score_status,
      pedro_applicability: runtimeArticle.pedro_applicability,
      pedro_quality_boost: runtimeArticle.pedro_quality_boost,
      pedro_explanation: runtimeArticle.pedro_explanation,
      pedro_score_source: runtimeArticle.pedro_score_source,
      pedro_score_matched_by: runtimeArticle.pedro_score_matched_by,
      abstract_source: runtimeArticle.abstract_source,
      abstract_length: runtimeArticle.abstract_length,
      abstract_enriched: runtimeArticle.abstract_enriched,
      full_text_available: runtimeArticle.full_text_available,
      full_text_url: runtimeArticle.full_text_url,
      full_text_source: runtimeArticle.full_text_source,
    };
  });
};

const originalGetCache = supabaseService.getCache;

supabaseService.getCache = async (...args) => {
  const cached = await originalGetCache(...args);

  if (
    cached &&
    (
      !Array.isArray(cached.response_json?.sourceDiagnostics) ||
      cached.response_json?.pedroRankingVersion !==
        PEDRO_RANKING_VERSION ||
      cached.response_json?.metadataEnrichmentVersion !==
        METADATA_ENRICHMENT_VERSION
    )
  ) {
    return null;
  }

  return cached;
};

const originalSetCache = supabaseService.setCache;

supabaseService.setCache = async (payload) => {
  const responseJson = attachSourceDiagnostics({
    ...payload.responseJson,
    pedroRankingVersion: PEDRO_RANKING_VERSION,
    metadataEnrichmentVersion: METADATA_ENRICHMENT_VERSION,
  });

  return originalSetCache({
    ...payload,
    responseJson,
  });
};
