const crypto = require("crypto");

const RESULT_SNAPSHOT_VERSION = "1.0.0";

const SNAPSHOT_ARTICLE_FIELDS = [
  "id",
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
  "pedro_score",
  "pedro_score_label",
  "pedro_score_status",
  "pedro_applicability",
  "pedro_quality_boost",
  "pedro_explanation",
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
  "trusted_source_label",
  "trusted_source_score",
  "relevance_score",
  "ranking_reason",
  "openphysio_evidence_score",
  "openphysio_priority_label",
  "score_breakdown",
  "appraisal_flags",
  "caution_flags",
  "query_relevance_score",
  "query_relevance_flags",
  "query_relevance_limitations",
  "reading_priority_score",
  "reading_priority_penalty",
  "condition_match",
  "intervention_match",
];

function cloneJsonValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function pickSnapshotArticleFields(article = {}, originalRank = null) {
  const snapshot = {
    original_rank: originalRank,
  };

  for (const field of SNAPSHOT_ARTICLE_FIELDS) {
    if (article[field] !== undefined) {
      snapshot[field] = cloneJsonValue(article[field]);
    }
  }

  return snapshot;
}

function canonicalSnapshotPayload(snapshot = {}) {
  return JSON.stringify({
    snapshot_version: snapshot.snapshot_version,
    source: snapshot.source,
    article_count: snapshot.article_count,
    articles: snapshot.articles,
  });
}

function calculateSnapshotChecksum(snapshot = {}) {
  return crypto
    .createHash("sha256")
    .update(canonicalSnapshotPayload(snapshot))
    .digest("hex");
}

function createSearchResultSnapshot(articles = [], options = {}) {
  const source = options.source || "live_search";
  const capturedAt = options.capturedAt || new Date().toISOString();
  const snapshot = {
    snapshot_version: RESULT_SNAPSHOT_VERSION,
    captured_at: capturedAt,
    source,
    article_count: articles.length,
    articles: articles.map((article, index) =>
      pickSnapshotArticleFields(article, index + 1)
    ),
  };

  return {
    ...snapshot,
    checksum_sha256: calculateSnapshotChecksum(snapshot),
  };
}

function verifySearchResultSnapshot(snapshot = {}) {
  if (!snapshot || typeof snapshot !== "object") {
    return {
      valid: false,
      reason: "missing_snapshot",
      expected_checksum: null,
      actual_checksum: null,
    };
  }

  if (!Array.isArray(snapshot.articles)) {
    return {
      valid: false,
      reason: "invalid_articles",
      expected_checksum: snapshot.checksum_sha256 || null,
      actual_checksum: null,
    };
  }

  const actualChecksum = calculateSnapshotChecksum(snapshot);
  const expectedChecksum = snapshot.checksum_sha256 || null;

  return {
    valid: Boolean(expectedChecksum && expectedChecksum === actualChecksum),
    reason:
      expectedChecksum && expectedChecksum === actualChecksum
        ? "checksum_match"
        : "checksum_mismatch",
    expected_checksum: expectedChecksum,
    actual_checksum: actualChecksum,
  };
}

module.exports = {
  RESULT_SNAPSHOT_VERSION,
  SNAPSHOT_ARTICLE_FIELDS,
  cloneJsonValue,
  pickSnapshotArticleFields,
  calculateSnapshotChecksum,
  createSearchResultSnapshot,
  verifySearchResultSnapshot,
};
