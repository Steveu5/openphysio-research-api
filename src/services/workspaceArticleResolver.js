const { getSupabaseAdmin, upsertArticles } = require("./supabase");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/i;
const PMID_PATTERN = /^\d{6,9}$/;
const PMCID_PATTERN = /^PMC\d+$/i;
const OPENALEX_PATTERN = /^(?:https?:\/\/openalex\.org\/)?W\d+$/i;

function cleanString(value, maxLength = 2000) {
  if (value == null) return null;
  const normalized = String(value).replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function isUuid(value) {
  return UUID_PATTERN.test(String(value || "").trim());
}

function normalizeDoi(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^doi:\s*/i, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/[?#].*$/, "")
    .trim();

  return DOI_PATTERN.test(normalized) ? normalized.toLowerCase() : null;
}

function normalizePmid(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//i, "")
    .replace(/\/$/, "");

  return PMID_PATTERN.test(normalized) ? normalized : null;
}

function normalizePmcid(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^https?:\/\/pmc\.ncbi\.nlm\.nih\.gov\/articles\//i, "")
    .replace(/\/$/, "")
    .toUpperCase();

  return PMCID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeOpenAlexId(value) {
  const normalized = String(value || "").trim();
  if (!OPENALEX_PATTERN.test(normalized)) return null;
  return normalized.replace(/^https?:\/\/openalex\.org\//i, "").toUpperCase();
}

function normalizeUrl(value) {
  const normalized = cleanString(value, 4000);
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function inferIdentifiers(value) {
  const raw = String(value || "").trim();
  if (!raw) return {};

  return {
    id: isUuid(raw) ? raw : null,
    doi: normalizeDoi(raw),
    pmid: normalizePmid(raw),
    pmcid: normalizePmcid(raw),
    openalex_id: normalizeOpenAlexId(raw),
    source_url: normalizeUrl(raw),
  };
}

function buildArticleCandidate({ articleId, article = {} } = {}) {
  const snapshot = article && typeof article === "object" ? article : {};
  const inferred = inferIdentifiers(articleId);
  const explicitId = isUuid(snapshot.id)
    ? snapshot.id
    : isUuid(snapshot.article_id)
      ? snapshot.article_id
      : inferred.id;

  const year = Number(snapshot.year);

  return {
    id: explicitId || null,
    title: cleanString(snapshot.title, 1000),
    abstract: cleanString(snapshot.abstract, 30000),
    clinical_takeaway: cleanString(snapshot.clinical_takeaway, 8000),
    doi: normalizeDoi(snapshot.doi) || inferred.doi,
    pmid: normalizePmid(snapshot.pmid) || inferred.pmid,
    pmcid: normalizePmcid(snapshot.pmcid) || inferred.pmcid,
    openalex_id:
      normalizeOpenAlexId(snapshot.openalex_id) || inferred.openalex_id,
    authors_text: cleanString(snapshot.authors_text, 4000),
    journal: cleanString(snapshot.journal, 500),
    year: Number.isFinite(year) && year > 0 ? year : null,
    publication_date: cleanString(snapshot.publication_date, 50),
    study_type: cleanString(snapshot.study_type, 300),
    source_name: cleanString(snapshot.source_name, 300),
    source_id: cleanString(snapshot.source_id, 1000),
    source_url:
      normalizeUrl(snapshot.source_url) ||
      normalizeUrl(snapshot.url) ||
      inferred.source_url,
    open_access:
      typeof snapshot.open_access === "boolean" ? snapshot.open_access : null,
    evidence_level: cleanString(snapshot.evidence_level, 300),
    evidence_level_label_es: cleanString(
      snapshot.evidence_level_label_es,
      500
    ),
    evidence_level_label_en: cleanString(
      snapshot.evidence_level_label_en,
      500
    ),
    evidence_level_rank: Number.isFinite(Number(snapshot.evidence_level_rank))
      ? Number(snapshot.evidence_level_rank)
      : null,
  };
}

async function findArticleId(supabase, candidate = {}) {
  const lookups = [
    ["id", candidate.id],
    ["doi", candidate.doi],
    ["pmid", candidate.pmid],
    ["pmcid", candidate.pmcid],
    ["openalex_id", candidate.openalex_id],
    ["source_url", candidate.source_url],
  ];

  for (const [field, value] of lookups) {
    if (!value) continue;

    const { data, error } = await supabase
      .from("research_articles")
      .select("id")
      .eq(field, value)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (isUuid(data?.id)) return data.id;
  }

  if (candidate.title) {
    let query = supabase
      .from("research_articles")
      .select("id")
      .eq("title", candidate.title);

    if (candidate.year) query = query.eq("year", candidate.year);

    const { data, error } = await query.limit(1).maybeSingle();
    if (error) throw error;
    if (isUuid(data?.id)) return data.id;
  }

  return null;
}

async function resolveWorkspaceArticleId(
  { articleId, article } = {},
  { getSupabase = getSupabaseAdmin, persistArticles = upsertArticles } = {}
) {
  const candidate = buildArticleCandidate({ articleId, article });
  const supabase = getSupabase();

  const existingId = await findArticleId(supabase, candidate);
  if (existingId) return existingId;

  if (!candidate.title) {
    const error = new Error("Article could not be resolved");
    error.status = 422;
    throw error;
  }

  const [persisted] = await persistArticles([candidate]);
  if (isUuid(persisted?.id)) return persisted.id;

  const createdId = await findArticleId(supabase, {
    ...candidate,
    ...persisted,
  });
  if (createdId) return createdId;

  const error = new Error("Article could not be persisted");
  error.status = 422;
  throw error;
}

module.exports = {
  buildArticleCandidate,
  findArticleId,
  inferIdentifiers,
  isUuid,
  normalizeDoi,
  normalizeOpenAlexId,
  normalizePmcid,
  normalizePmid,
  normalizeUrl,
  resolveWorkspaceArticleId,
};
