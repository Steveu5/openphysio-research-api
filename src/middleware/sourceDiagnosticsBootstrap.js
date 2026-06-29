const express = require("express");
const {
  sourceDiagnosticsMiddleware,
  attachSourceDiagnostics,
} = require("./sourceDiagnostics");
const supabaseService = require("../services/supabase");
const rankingService = require("../services/ranking");
const {
  ensureStoredPedroScoresLoaded,
  enrichArticlesWithStoredPedroScores,
} = require("../services/storedPedroScores");

const PEDRO_RANKING_VERSION = 1;
const originalHandle = express.application.handle;

express.application.handle = function handleWithResearchEnhancements(
  req,
  res,
  done
) {
  if (!req.originalUrl && req.url) {
    req.originalUrl = req.url;
  }

  const isResearchSearch = req.originalUrl?.startsWith(
    "/research/search"
  );

  const continueRequest = () => sourceDiagnosticsMiddleware(
    req,
    res,
    () => originalHandle.call(this, req, res, done)
  );

  if (!isResearchSearch) {
    return continueRequest();
  }

  return Promise.resolve(
    ensureStoredPedroScoresLoaded()
  )
    .then(continueRequest)
    .catch(done);
};

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
        PEDRO_RANKING_VERSION
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
  });

  return originalSetCache({
    ...payload,
    responseJson,
  });
};
