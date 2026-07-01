const { getSupabaseAdmin } = require("./supabase");
const { buildSearchHistoryAudit } = require("./searchHistoryAudit");

async function getSearchHistoryAudit(userId, queryId) {
  const supabase = getSupabaseAdmin();

  const { data: queryRecord, error: queryError } = await supabase
    .from("research_search_queries")
    .select(
      "id,user_id,query_text,normalized_query,parsed_query,query_language,created_at"
    )
    .eq("id", queryId)
    .eq("user_id", userId)
    .maybeSingle();

  if (queryError) throw queryError;
  if (!queryRecord) return null;

  const { data: resultRows, error: resultsError } = await supabase
    .from("research_search_results")
    .select(
      "query_id,article_id,rank_position,relevance_score,ranking_reason,research_articles(*)"
    )
    .eq("query_id", queryId)
    .order("rank_position", { ascending: true });

  if (resultsError) throw resultsError;

  return buildSearchHistoryAudit({
    queryRecord,
    resultRows: resultRows || [],
  });
}

module.exports = {
  getSearchHistoryAudit,
};
