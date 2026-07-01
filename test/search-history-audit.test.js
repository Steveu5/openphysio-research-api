const test = require("node:test");
const assert = require("node:assert/strict");

const { getResearchSystemMetadata } = require("../src/config/researchSystemVersion");
const {
  compareResearchSystemSnapshots,
  compareRankingPositions,
  buildSearchHistoryAudit,
} = require("../src/services/searchHistoryAudit");

test("system snapshot comparison identifies current and changed versions", () => {
  const current = getResearchSystemMetadata();
  const matching = compareResearchSystemSnapshots(current, current);

  assert.equal(matching.status, "current");
  assert.equal(matching.is_current, true);
  assert.deepEqual(matching.differences, []);

  const stored = {
    ...current,
    ranking_version: "0.9.0",
    prompts: {
      ...current.prompts,
      research_answer: "0.8.0",
    },
  };
  const changed = compareResearchSystemSnapshots(stored, current);

  assert.equal(changed.status, "version_changed");
  assert.equal(changed.is_current, false);
  assert.deepEqual(
    changed.differences.map((item) => item.field),
    ["ranking_version", "prompts.research_answer"]
  );
});

test("legacy searches are explicitly marked as unversioned", () => {
  const comparison = compareResearchSystemSnapshots(null);

  assert.equal(comparison.status, "legacy_unversioned");
  assert.equal(comparison.is_current, false);
  assert.deepEqual(comparison.changed_components, ["provenance"]);
});

test("ranking comparison reports upward, downward, new, and removed movement", () => {
  const original = [
    { article_id: "a", rank_position: 1, research_articles: { id: "a", title: "A" } },
    { article_id: "b", rank_position: 2, research_articles: { id: "b", title: "B" } },
    { article_id: "c", rank_position: 3, research_articles: { id: "c", title: "C" } },
  ];
  const current = [
    { id: "b", title: "B" },
    { id: "a", title: "A" },
    { id: "d", title: "D" },
  ];

  const comparison = compareRankingPositions(original, current);
  const byId = new Map(comparison.items.map((item) => [item.article_id, item]));

  assert.equal(byId.get("a").movement, "down");
  assert.equal(byId.get("a").rank_change, -1);
  assert.equal(byId.get("b").movement, "up");
  assert.equal(byId.get("b").rank_change, 1);
  assert.equal(byId.get("c").movement, "removed");
  assert.equal(byId.get("d").movement, "new");
  assert.deepEqual(comparison.summary, {
    total_original: 3,
    total_current: 3,
    unchanged: 0,
    moved_up: 1,
    moved_down: 1,
    new: 1,
    removed: 1,
  });
});

test("audit preserves historical order and compares it with an injected current ranker", () => {
  const system = getResearchSystemMetadata();
  const queryRecord = {
    id: "query-1",
    query_text: "exercise for knee osteoarthritis",
    normalized_query: "knee osteoarthritis exercise",
    query_language: "en",
    created_at: "2026-07-01T10:00:00.000Z",
    parsed_query: {
      condition: "knee osteoarthritis",
      intervention: "exercise",
      _openphysio_system: system,
    },
  };
  const resultRows = [
    {
      article_id: "a",
      rank_position: 1,
      relevance_score: 90,
      ranking_reason: "Historical A",
      research_articles: { id: "a", title: "Article A", year: 2024 },
    },
    {
      article_id: "b",
      rank_position: 2,
      relevance_score: 80,
      ranking_reason: "Historical B",
      research_articles: { id: "b", title: "Article B", year: 2025 },
    },
  ];
  const ranker = (articles, intent) => {
    assert.equal(intent.condition, "knee osteoarthritis");
    assert.equal(intent._openphysio_system, undefined);
    return [
      { ...articles[1], reading_priority_score: 95, relevance_score: 92 },
      { ...articles[0], reading_priority_score: 85, relevance_score: 88 },
    ];
  };

  const audit = buildSearchHistoryAudit({
    queryRecord,
    resultRows,
    currentSystem: system,
    ranker,
  });

  assert.equal(audit.provenance.comparison.status, "current");
  assert.equal(audit.original_ranking[0].article_id, "a");
  assert.equal(audit.current_ranking[0].article_id, "b");
  assert.equal(audit.ranking_comparison.items[0].movement, "down");
  assert.equal(audit.reproducibility.level, "partial");
  assert.equal(
    audit.reproducibility.immutable_article_metadata_snapshot_preserved,
    false
  );
});
