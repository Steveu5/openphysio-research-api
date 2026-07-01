const test = require("node:test");
const assert = require("node:assert/strict");

const { getResearchSystemMetadata } = require("../src/config/researchSystemVersion");
const {
  createSearchResultSnapshot,
  verifySearchResultSnapshot,
} = require("../src/services/searchResultSnapshot");
const {
  buildSearchHistoryAudit,
} = require("../src/services/searchHistoryAudit");

test("result snapshots preserve ranked metadata and verify integrity", () => {
  const snapshot = createSearchResultSnapshot(
    [
      {
        id: "article-a",
        title: "Exercise for knee osteoarthritis",
        abstract: "A randomized clinical trial.",
        relevance_score: 91,
        reading_priority_score: 94,
        ranking_reason: "Direct condition and intervention match",
        raw_metadata: { large: "not persisted" },
      },
    ],
    {
      source: "live_search",
      capturedAt: "2026-07-01T10:00:00.000Z",
    }
  );

  assert.equal(snapshot.snapshot_version, "1.0.0");
  assert.equal(snapshot.article_count, 1);
  assert.equal(snapshot.articles[0].original_rank, 1);
  assert.equal(snapshot.articles[0].title, "Exercise for knee osteoarthritis");
  assert.equal(snapshot.articles[0].raw_metadata, undefined);
  assert.match(snapshot.checksum_sha256, /^[a-f0-9]{64}$/);
  assert.equal(verifySearchResultSnapshot(snapshot).valid, true);
});

test("result snapshot verification detects changed article data", () => {
  const snapshot = createSearchResultSnapshot([
    { id: "article-a", title: "Original title" },
  ]);
  snapshot.articles[0].title = "Changed title";

  const verification = verifySearchResultSnapshot(snapshot);

  assert.equal(verification.valid, false);
  assert.equal(verification.reason, "checksum_mismatch");
});

test("historical audit uses the immutable snapshot instead of mutable article rows", () => {
  const system = getResearchSystemMetadata();
  const snapshot = createSearchResultSnapshot([
    {
      id: "article-a",
      title: "Original Article A",
      relevance_score: 90,
      ranking_reason: "Historical A",
    },
    {
      id: "article-b",
      title: "Original Article B",
      relevance_score: 80,
      ranking_reason: "Historical B",
    },
  ]);

  const audit = buildSearchHistoryAudit({
    queryRecord: {
      id: "query-1",
      query_text: "exercise for knee osteoarthritis",
      parsed_query: {
        condition: "knee osteoarthritis",
        intervention: "exercise",
        _openphysio_system: system,
        _openphysio_result_snapshot: snapshot,
      },
    },
    resultRows: [
      {
        article_id: "article-a",
        rank_position: 1,
        research_articles: {
          id: "article-a",
          title: "Later database title A",
        },
      },
      {
        article_id: "article-b",
        rank_position: 2,
        research_articles: {
          id: "article-b",
          title: "Later database title B",
        },
      },
    ],
    currentSystem: system,
    ranker: (articles, intent) => {
      assert.equal(intent._openphysio_result_snapshot, undefined);
      assert.equal(articles[0].title, "Original Article A");
      return [articles[1], articles[0]];
    },
  });

  assert.equal(audit.result_snapshot.valid, true);
  assert.equal(audit.original_ranking[0].title, "Original Article A");
  assert.equal(audit.current_ranking[0].article_id, "article-b");
  assert.equal(audit.reproducibility.level, "exact_historical_state");
  assert.equal(audit.reproducibility.historical_state_integrity_verified, true);
});
