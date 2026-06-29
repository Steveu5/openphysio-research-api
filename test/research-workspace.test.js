const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_COLLECTION,
  sanitizeCollectionName,
  sanitizeNotes,
  normalizePagination,
  aggregateCollections,
  mapSavedArticle,
} = require("../src/services/researchWorkspace");

test("normalizes collection names and uses General as fallback", () => {
  assert.equal(sanitizeCollectionName("  Tendón   de Aquiles  "), "Tendón de Aquiles");
  assert.equal(sanitizeCollectionName(""), DEFAULT_COLLECTION);
  assert.equal(sanitizeCollectionName(null), DEFAULT_COLLECTION);
});

test("limits collection names and notes", () => {
  assert.equal(sanitizeCollectionName("A".repeat(100)).length, 80);
  assert.equal(sanitizeNotes("B".repeat(5000)).length, 4000);
  assert.equal(sanitizeNotes("   "), null);
});

test("normalizes safe pagination bounds", () => {
  assert.deepEqual(normalizePagination({ limit: 500, offset: -10 }), {
    limit: 100,
    offset: 0,
    from: 0,
    to: 99,
  });

  assert.deepEqual(normalizePagination({ limit: 25, offset: 50 }), {
    limit: 25,
    offset: 50,
    from: 50,
    to: 74,
  });
});

test("aggregates virtual collections and keeps General first", () => {
  const collections = aggregateCollections([
    {
      collection_name: "Hombro",
      saved_at: "2026-06-20T10:00:00.000Z",
    },
    {
      collection_name: "Hombro",
      saved_at: "2026-06-22T10:00:00.000Z",
    },
    {
      collection_name: "Rodilla",
      saved_at: "2026-06-21T10:00:00.000Z",
    },
  ]);

  assert.equal(collections[0].name, DEFAULT_COLLECTION);
  assert.equal(collections[0].article_count, 0);

  const shoulder = collections.find((item) => item.name === "Hombro");
  assert.equal(shoulder.article_count, 2);
  assert.equal(shoulder.latest_saved_at, "2026-06-22T10:00:00.000Z");
});

test("maps saved records into a stable API contract", () => {
  const mapped = mapSavedArticle({
    id: "saved-1",
    article_id: "article-1",
    collection_name: null,
    notes: "Revisar dosis",
    saved_at: "2026-06-29T10:00:00.000Z",
    research_articles: {
      id: "article-1",
      title: "Exercise therapy",
    },
  });

  assert.equal(mapped.collection_name, DEFAULT_COLLECTION);
  assert.equal(mapped.article.id, "article-1");
  assert.equal(mapped.notes, "Revisar dosis");
});
