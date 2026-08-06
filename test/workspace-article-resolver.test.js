const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildArticleCandidate,
  inferIdentifiers,
  normalizeDoi,
  resolveWorkspaceArticleId,
} = require("../src/services/workspaceArticleResolver");

function createEmptySupabase() {
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    limit() {
      return this;
    },
    async maybeSingle() {
      return { data: null, error: null };
    },
  };

  return {
    from() {
      return query;
    },
  };
}

test("normalizes DOI links and bibliographic identifiers", () => {
  assert.equal(
    normalizeDoi("https://doi.org/10.2519/jospt.2018.0302"),
    "10.2519/jospt.2018.0302"
  );

  assert.deepEqual(
    inferIdentifiers("https://pubmed.ncbi.nlm.nih.gov/29399777/"),
    {
      id: null,
      doi: null,
      pmid: "29399777",
      pmcid: null,
      openalex_id: null,
      source_url: "https://pubmed.ncbi.nlm.nih.gov/29399777/",
    }
  );
});

test("builds a safe article candidate from a local Research favorite", () => {
  const candidate = buildArticleCandidate({
    articleId: "10.2519/jospt.2018.0302",
    article: {
      title: "Midportion Achilles Tendinopathy: Clinical Practice Guidelines",
      journal: "JOSPT",
      year: 2018,
      source_url: "https://pubmed.ncbi.nlm.nih.gov/29712543/",
    },
  });

  assert.equal(candidate.doi, "10.2519/jospt.2018.0302");
  assert.equal(candidate.year, 2018);
  assert.equal(candidate.journal, "JOSPT");
  assert.equal(
    candidate.source_url,
    "https://pubmed.ncbi.nlm.nih.gov/29712543/"
  );
});

test("persists a missing displayed article and returns its internal UUID", async () => {
  const createdId = "3104d609-7870-43ed-8bd7-ff17a87f20d8";
  let persistedCandidate = null;

  const resolved = await resolveWorkspaceArticleId(
    {
      articleId: "https://pubmed.ncbi.nlm.nih.gov/29712543/",
      article: {
        title: "Midportion Achilles Tendinopathy",
        year: 2018,
        source_url: "https://pubmed.ncbi.nlm.nih.gov/29712543/",
      },
    },
    {
      getSupabase: () => createEmptySupabase(),
      persistArticles: async (articles) => {
        [persistedCandidate] = articles;
        return [{ ...articles[0], id: createdId }];
      },
    }
  );

  assert.equal(resolved, createdId);
  assert.equal(persistedCandidate.pmid, "29712543");
  assert.equal(persistedCandidate.title, "Midportion Achilles Tendinopathy");
});
