const { createClient } = require("@supabase/supabase-js");
const { getResearchSystemMetadata } = require("../config/researchSystemVersion");
const {
  createSearchResultSnapshot,
} = require("./searchResultSnapshot");

let supabaseAdmin = null;

const ARTICLE_DB_FIELDS = [
  "title",
  "abstract",
  "clinical_takeaway",
  "doi",
  "pmid",
  "pmcid",
  "openalex_id",
  "authors_text",
  "journal",
  "year",
  "publication_date",
  "study_type",
  "source_name",
  "source_id",
  "source_url",
  "open_access",
  "raw_metadata",
  "pedro_score",
  "body_region",
  "condition",
  "intervention",
  "population",
  "outcome",
  "evidence_level",
  "evidence_level_label_es",
  "evidence_level_label_en",
  "evidence_level_rank",
  "physiotherapy_relevance_score",
  "physiotherapy_terms",
  "is_physiotherapy_relevant",
  "relevance_score",
  "ranking_reason",
];

function pickArticleDbFields(article = {}) {
  const dbArticle = {};

  for (const field of ARTICLE_DB_FIELDS) {
    if (article[field] !== undefined) {
      dbArticle[field] = article[field];
    }
  }

  return dbArticle;
}

function mergeSavedArticleWithRuntimeFields(savedArticle = {}, runtimeArticle = {}) {
  return {
    ...savedArticle,
    openphysio_evidence_score: runtimeArticle.openphysio_evidence_score,
    openphysio_priority_label: runtimeArticle.openphysio_priority_label,
    score_breakdown: runtimeArticle.score_breakdown,
    appraisal_flags: runtimeArticle.appraisal_flags,
    caution_flags: runtimeArticle.caution_flags,
    trusted_source_label: runtimeArticle.trusted_source_label,
    trusted_source_score: runtimeArticle.trusted_source_score,
    query_relevance_score: runtimeArticle.query_relevance_score,
    query_relevance_flags: runtimeArticle.query_relevance_flags,
    query_relevance_limitations: runtimeArticle.query_relevance_limitations,
    reading_priority_score: runtimeArticle.reading_priority_score,
    retrieval_source_name: runtimeArticle.retrieval_source_name,
    targeted_search_strategy: runtimeArticle.targeted_search_strategy,
    preferred_source_tier: runtimeArticle.preferred_source_tier,
    preferred_source_key: runtimeArticle.preferred_source_key,
    preferred_source_label_es: runtimeArticle.preferred_source_label_es,
    preferred_source_label_en: runtimeArticle.preferred_source_label_en,
    preferred_source_reason_es: runtimeArticle.preferred_source_reason_es,
    preferred_source_reason_en: runtimeArticle.preferred_source_reason_en,
    guideline_applicability: runtimeArticle.guideline_applicability,
    guideline_scope_label_es: runtimeArticle.guideline_scope_label_es,
    guideline_scope_label_en: runtimeArticle.guideline_scope_label_en,
    guideline_scope_note_es: runtimeArticle.guideline_scope_note_es,
    guideline_scope_note_en: runtimeArticle.guideline_scope_note_en,
    condition_match: runtimeArticle.condition_match,
  };
}

function addResearchProvenanceToParsedQuery(parsedQuery = {}) {
  return {
    ...parsedQuery,
    _openphysio_system: getResearchSystemMetadata(),
  };
}

function addResultSnapshotToParsedQuery(parsedQuery = {}, resultSnapshot = null) {
  return {
    ...addResearchProvenanceToParsedQuery(parsedQuery),
    ...(resultSnapshot
      ? { _openphysio_result_snapshot: resultSnapshot }
      : {}),
  };
}

function addResearchProvenanceToResponse(responseJson = {}) {
  return {
    ...responseJson,
    researchSystem: getResearchSystemMetadata(),
  };
}

function getSupabaseAdmin() {
  if (supabaseAdmin) return supabaseAdmin;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  supabaseAdmin = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return supabaseAdmin;
}

async function getCache(queryHash) {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("research_query_cache")
    .select("*")
    .eq("query_hash", queryHash)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return null;
  }

  await supabase
    .from("research_query_cache")
    .update({ hit_count: (data.hit_count || 0) + 1 })
    .eq("id", data.id);

  return data;
}

async function setCache({ queryHash, normalizedQuery, parsedQuery, responseJson, resultsJson }) {
  const supabase = getSupabaseAdmin();

  const ttlHours = Number(process.env.CACHE_TTL_HOURS || 24);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from("research_query_cache")
    .upsert(
      {
        query_hash: queryHash,
        normalized_query: normalizedQuery,
        parsed_query: addResearchProvenanceToParsedQuery(parsedQuery),
        response_json: addResearchProvenanceToResponse(responseJson),
        results_json: resultsJson,
        expires_at: expiresAt,
      },
      { onConflict: "query_hash" }
    );

  if (error) console.warn("Cache save error:", error.message);
}

async function saveSearchQuery({ userId, sessionId, queryText, normalizedQuery, parsedQuery, queryLanguage }) {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("research_search_queries")
    .insert({
      user_id: userId,
      session_id: sessionId,
      query_text: queryText,
      normalized_query: normalizedQuery,
      parsed_query: addResearchProvenanceToParsedQuery(parsedQuery),
      query_language: queryLanguage,
    })
    .select("*")
    .single();

  if (error) {
    console.warn("Search query save error:", error.message);
    return null;
  }

  return data;
}

async function saveSearchSnapshot({ queryId, parsedQuery, articles, source }) {
  if (!queryId) return null;

  const supabase = getSupabaseAdmin();
  const resultSnapshot = createSearchResultSnapshot(articles || [], {
    source,
  });

  const { data, error } = await supabase
    .from("research_search_queries")
    .update({
      parsed_query: addResultSnapshotToParsedQuery(parsedQuery, resultSnapshot),
    })
    .eq("id", queryId)
    .select("id,parsed_query")
    .maybeSingle();

  if (error) {
    console.warn("Search snapshot save error:", error.message);
    return null;
  }

  return data?.parsed_query?._openphysio_result_snapshot || resultSnapshot;
}

async function findExistingArticle(article) {
  const supabase = getSupabaseAdmin();

  const orParts = [];
  if (article.doi) orParts.push(`doi.eq.${article.doi}`);
  if (article.pmid) orParts.push(`pmid.eq.${article.pmid}`);
  if (article.pmcid) orParts.push(`pmcid.eq.${article.pmcid}`);
  if (article.openalex_id) orParts.push(`openalex_id.eq.${article.openalex_id}`);

  if (!orParts.length) return null;

  const { data, error } = await supabase
    .from("research_articles")
    .select("*")
    .or(orParts.join(","))
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("Find existing article error:", error.message);
    return null;
  }

  return data;
}

async function upsertOneArticle(article) {
  const supabase = getSupabaseAdmin();

  const existing = await findExistingArticle(article);

  if (existing) {
    const updatePayload = pickArticleDbFields({
      times_seen: (existing.times_seen || 0) + 1,
      last_seen_at: new Date().toISOString(),

      evidence_level: article.evidence_level || existing.evidence_level || null,
      evidence_level_label_es: article.evidence_level_label_es || existing.evidence_level_label_es || null,
      evidence_level_label_en: article.evidence_level_label_en || existing.evidence_level_label_en || null,
      evidence_level_rank: article.evidence_level_rank || existing.evidence_level_rank || null,
      physiotherapy_relevance_score: article.physiotherapy_relevance_score ?? existing.physiotherapy_relevance_score ?? null,
      physiotherapy_terms: article.physiotherapy_terms || existing.physiotherapy_terms || [],
      is_physiotherapy_relevant: article.is_physiotherapy_relevant ?? existing.is_physiotherapy_relevant ?? null,
      relevance_score: article.relevance_score || existing.relevance_score || null,
      ranking_reason: article.ranking_reason || existing.ranking_reason || null,
    });

    updatePayload.times_seen = (existing.times_seen || 0) + 1;
    updatePayload.last_seen_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("research_articles")
      .update(updatePayload)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) {
      return mergeSavedArticleWithRuntimeFields(existing, article);
    }

    return mergeSavedArticleWithRuntimeFields(data, article);
  }

  const insertPayload = {
    ...pickArticleDbFields(article),
    times_seen: 1,
    last_seen_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("research_articles")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    console.warn("Insert article error:", error.message, article.title);
    return article;
  }

  return mergeSavedArticleWithRuntimeFields(data, article);
}

async function upsertArticles(articles) {
  const saved = [];

  for (const article of articles) {
    const item = await upsertOneArticle(article);
    saved.push(item);
  }

  return saved;
}

async function saveSearchResults(queryId, articles) {
  const supabase = getSupabaseAdmin();

  const rows = articles
    .filter((article) => article.id)
    .map((article, index) => ({
      query_id: queryId,
      article_id: article.id,
      rank_position: index + 1,
      relevance_score: article.relevance_score || null,
      ranking_reason: article.ranking_reason || null,
    }));

  if (!rows.length) return;

  const { error } = await supabase
    .from("research_search_results")
    .upsert(rows, { onConflict: "query_id,article_id" });

  if (error) console.warn("Save search results error:", error.message);
}

module.exports = {
  getSupabaseAdmin,
  getCache,
  setCache,
  saveSearchQuery,
  saveSearchSnapshot,
  upsertArticles,
  saveSearchResults,
  addResearchProvenanceToParsedQuery,
  addResultSnapshotToParsedQuery,
  addResearchProvenanceToResponse,
};
