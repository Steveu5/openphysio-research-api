const { getSupabaseAdmin } = require("./supabase");

const DEFAULT_COLLECTION = "General";
const MAX_COLLECTION_LENGTH = 80;
const MAX_NOTES_LENGTH = 4000;

function sanitizeCollectionName(value, fallback = DEFAULT_COLLECTION) {
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return fallback;
  return normalized.slice(0, MAX_COLLECTION_LENGTH);
}

function sanitizeNotes(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, MAX_NOTES_LENGTH) : null;
}

function normalizePagination({ limit, offset } = {}) {
  const normalizedLimit = Math.min(
    Math.max(Number(limit) || 20, 1),
    100
  );
  const normalizedOffset = Math.max(Number(offset) || 0, 0);

  return {
    limit: normalizedLimit,
    offset: normalizedOffset,
    from: normalizedOffset,
    to: normalizedOffset + normalizedLimit - 1,
  };
}

function aggregateCollections(savedRows = []) {
  const grouped = new Map();

  for (const row of savedRows) {
    const name = sanitizeCollectionName(row.collection_name);
    const savedAt = row.saved_at || null;
    const current = grouped.get(name) || {
      name,
      article_count: 0,
      latest_saved_at: null,
    };

    current.article_count += 1;

    if (
      savedAt &&
      (!current.latest_saved_at || new Date(savedAt) > new Date(current.latest_saved_at))
    ) {
      current.latest_saved_at = savedAt;
    }

    grouped.set(name, current);
  }

  if (!grouped.has(DEFAULT_COLLECTION)) {
    grouped.set(DEFAULT_COLLECTION, {
      name: DEFAULT_COLLECTION,
      article_count: 0,
      latest_saved_at: null,
    });
  }

  return Array.from(grouped.values()).sort((a, b) => {
    if (a.name === DEFAULT_COLLECTION) return -1;
    if (b.name === DEFAULT_COLLECTION) return 1;
    return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
  });
}

function mapSavedArticle(row = {}) {
  const article = row.research_articles || null;

  return {
    id: row.id,
    article_id: row.article_id,
    collection_name: sanitizeCollectionName(row.collection_name),
    notes: row.notes || null,
    saved_at: row.saved_at || null,
    article,
  };
}

async function listSearchHistory(userId, options = {}) {
  const supabase = getSupabaseAdmin();
  const pagination = normalizePagination(options);

  const { data, error, count } = await supabase
    .from("research_search_queries")
    .select(
      "id,query_text,normalized_query,parsed_query,query_language,created_at",
      { count: "exact" }
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(pagination.from, pagination.to);

  if (error) throw error;

  const queries = data || [];
  const queryIds = queries.map((item) => item.id).filter(Boolean);
  const resultCounts = new Map();

  if (queryIds.length) {
    const { data: resultRows, error: resultError } = await supabase
      .from("research_search_results")
      .select("query_id")
      .in("query_id", queryIds);

    if (resultError) throw resultError;

    for (const row of resultRows || []) {
      resultCounts.set(
        row.query_id,
        (resultCounts.get(row.query_id) || 0) + 1
      );
    }
  }

  const items = queries.map((query) => ({
    id: query.id,
    query: query.query_text,
    normalized_query: query.normalized_query || null,
    condition: query.parsed_query?.condition || null,
    intervention: query.parsed_query?.intervention || null,
    body_region: query.parsed_query?.body_region || null,
    population: query.parsed_query?.population || null,
    outcome: query.parsed_query?.outcome || null,
    language: query.query_language || null,
    created_at: query.created_at,
    result_count: resultCounts.get(query.id) || 0,
  }));

  return {
    items,
    total: count || 0,
    limit: pagination.limit,
    offset: pagination.offset,
  };
}

async function deleteSearchHistoryItem(userId, queryId) {
  const supabase = getSupabaseAdmin();

  const { data: ownedQuery, error: lookupError } = await supabase
    .from("research_search_queries")
    .select("id")
    .eq("id", queryId)
    .eq("user_id", userId)
    .maybeSingle();

  if (lookupError) throw lookupError;
  if (!ownedQuery) return false;

  const { error: resultError } = await supabase
    .from("research_search_results")
    .delete()
    .eq("query_id", queryId);

  if (resultError) throw resultError;

  const { error: queryError } = await supabase
    .from("research_search_queries")
    .delete()
    .eq("id", queryId)
    .eq("user_id", userId);

  if (queryError) throw queryError;
  return true;
}

async function clearSearchHistory(userId) {
  const supabase = getSupabaseAdmin();

  const { data: queries, error: lookupError } = await supabase
    .from("research_search_queries")
    .select("id")
    .eq("user_id", userId);

  if (lookupError) throw lookupError;

  const queryIds = (queries || []).map((item) => item.id).filter(Boolean);

  if (queryIds.length) {
    const { error: resultError } = await supabase
      .from("research_search_results")
      .delete()
      .in("query_id", queryIds);

    if (resultError) throw resultError;
  }

  const { error: queryError } = await supabase
    .from("research_search_queries")
    .delete()
    .eq("user_id", userId);

  if (queryError) throw queryError;
  return queryIds.length;
}

async function ensureArticleExists(articleId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("research_articles")
    .select("id")
    .eq("id", articleId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

async function saveArticleToWorkspace({
  userId,
  articleId,
  collectionName,
  notes,
}) {
  const supabase = getSupabaseAdmin();
  const articleExists = await ensureArticleExists(articleId);

  if (!articleExists) {
    const error = new Error("Article not found");
    error.status = 404;
    throw error;
  }

  const payload = {
    user_id: userId,
    article_id: articleId,
    collection_name: sanitizeCollectionName(collectionName),
    notes: sanitizeNotes(notes),
  };

  const { data, error } = await supabase
    .from("research_saved_articles")
    .upsert(payload, { onConflict: "user_id,article_id" })
    .select("*, research_articles(*)")
    .single();

  if (error) throw error;
  return mapSavedArticle(data);
}

async function listSavedArticles(userId, options = {}) {
  const supabase = getSupabaseAdmin();
  const pagination = normalizePagination(options);
  const collectionName = options.collectionName
    ? sanitizeCollectionName(options.collectionName)
    : null;

  let query = supabase
    .from("research_saved_articles")
    .select("*, research_articles(*)", { count: "exact" })
    .eq("user_id", userId)
    .order("saved_at", { ascending: false })
    .range(pagination.from, pagination.to);

  if (collectionName) {
    query = query.eq("collection_name", collectionName);
  }

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    items: (data || []).map(mapSavedArticle),
    total: count || 0,
    limit: pagination.limit,
    offset: pagination.offset,
    collection_name: collectionName,
  };
}

async function updateSavedArticle({
  userId,
  articleId,
  collectionName,
  notes,
}) {
  const supabase = getSupabaseAdmin();
  const payload = {};

  if (collectionName !== undefined) {
    payload.collection_name = sanitizeCollectionName(collectionName);
  }

  if (notes !== undefined) {
    payload.notes = sanitizeNotes(notes);
  }

  if (!Object.keys(payload).length) {
    const error = new Error("No changes supplied");
    error.status = 400;
    throw error;
  }

  const { data, error } = await supabase
    .from("research_saved_articles")
    .update(payload)
    .eq("user_id", userId)
    .eq("article_id", articleId)
    .select("*, research_articles(*)")
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    const notFound = new Error("Saved article not found");
    notFound.status = 404;
    throw notFound;
  }

  return mapSavedArticle(data);
}

async function removeSavedArticle(userId, articleId) {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("research_saved_articles")
    .delete()
    .eq("user_id", userId)
    .eq("article_id", articleId)
    .select("article_id")
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

async function listCollections(userId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("research_saved_articles")
    .select("collection_name,saved_at")
    .eq("user_id", userId)
    .order("saved_at", { ascending: false });

  if (error) throw error;
  return aggregateCollections(data || []);
}

async function renameCollection({ userId, currentName, newName }) {
  const supabase = getSupabaseAdmin();
  const source = sanitizeCollectionName(currentName);
  const target = sanitizeCollectionName(newName, "");

  if (!target) {
    const error = new Error("New collection name is required");
    error.status = 400;
    throw error;
  }

  if (source === target) {
    return { updated: 0, name: target };
  }

  const { data, error } = await supabase
    .from("research_saved_articles")
    .update({ collection_name: target })
    .eq("user_id", userId)
    .eq("collection_name", source)
    .select("article_id");

  if (error) throw error;

  return {
    updated: (data || []).length,
    name: target,
  };
}

async function deleteCollection({
  userId,
  collectionName,
  mode = "move_to_general",
}) {
  const supabase = getSupabaseAdmin();
  const source = sanitizeCollectionName(collectionName);

  if (source === DEFAULT_COLLECTION && mode === "move_to_general") {
    return { affected: 0, mode, collection_name: source };
  }

  if (mode === "delete_articles") {
    const { data, error } = await supabase
      .from("research_saved_articles")
      .delete()
      .eq("user_id", userId)
      .eq("collection_name", source)
      .select("article_id");

    if (error) throw error;

    return {
      affected: (data || []).length,
      mode,
      collection_name: source,
    };
  }

  const { data, error } = await supabase
    .from("research_saved_articles")
    .update({ collection_name: DEFAULT_COLLECTION })
    .eq("user_id", userId)
    .eq("collection_name", source)
    .select("article_id");

  if (error) throw error;

  return {
    affected: (data || []).length,
    mode: "move_to_general",
    collection_name: source,
  };
}

module.exports = {
  DEFAULT_COLLECTION,
  sanitizeCollectionName,
  sanitizeNotes,
  normalizePagination,
  aggregateCollections,
  mapSavedArticle,
  listSearchHistory,
  deleteSearchHistoryItem,
  clearSearchHistory,
  saveArticleToWorkspace,
  listSavedArticles,
  updateSavedArticle,
  removeSavedArticle,
  listCollections,
  renameCollection,
  deleteCollection,
};
