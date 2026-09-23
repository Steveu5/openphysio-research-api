const test = require("node:test");
const assert = require("node:assert/strict");

const { buildSearchResultRows } = require("../src/services/supabase");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

test("search result rows never repeat an article, keeping its best rank", () => {
  const rows = buildSearchResultRows("q", [
    { id: A, relevance_score: 90, ranking_reason: "guideline" },
    { id: B, relevance_score: 80 },
    { id: A, relevance_score: 70, ranking_reason: "duplicate from another source" },
    { id: "not-a-uuid" },
  ]);
  assert.deepEqual(
    rows.map((row) => [row.article_id, row.rank_position, row.ranking_reason]),
    [
      [A, 1, "guideline"],
      [B, 2, null],
    ]
  );
});
