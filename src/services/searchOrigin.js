// Which tool ran a search. Chat and Research share the search engine and the
// research_search_queries table (cache, snapshots, telemetry), but the
// Research history only shows searches made from Research.
//
// The origin is stored explicitly in parsed_query._openphysio_origin.
// Rows saved before this field existed are classified by session_id: Chat
// always sends its conversation id, Research never sends one.

const SEARCH_ORIGINS = ["chat", "research"];
const ORIGIN_KEY = "_openphysio_origin";

function normalizeSearchOrigin(origin) {
  return SEARCH_ORIGINS.includes(origin) ? origin : "research";
}

// PostgREST `or` filter: explicit Research rows, plus legacy rows without an
// origin that have no Chat conversation id.
const RESEARCH_HISTORY_FILTER =
  `parsed_query->>${ORIGIN_KEY}.eq.research,` +
  `and(parsed_query->>${ORIGIN_KEY}.is.null,session_id.is.null)`;

function searchOriginOf(row = {}) {
  const explicit = row.parsed_query?.[ORIGIN_KEY];
  if (SEARCH_ORIGINS.includes(explicit)) return explicit;
  return row.session_id ? "chat" : "research";
}

module.exports = {
  SEARCH_ORIGINS,
  ORIGIN_KEY,
  RESEARCH_HISTORY_FILTER,
  normalizeSearchOrigin,
  searchOriginOf,
};
