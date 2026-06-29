const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCochraneSearchUrl,
  normalizeCochraneWork,
} = require("../src/services/cochraneCrossref");
const {
  searchPubMed,
  simplifyPubMedQuery,
} = require("../src/services/pubmed");

test("Cochrane usa una búsqueda dirigida en Crossref", () => {
  const url = buildCochraneSearchUrl(
    "exercise low back pain",
    8,
    { year_from: 2020 }
  );

  assert.equal(
    url.searchParams.get("query.container-title"),
    "Cochrane Database of Systematic Reviews"
  );
  assert.equal(
    url.searchParams.get("filter"),
    "from-pub-date:2020-01-01"
  );

  const normalized = normalizeCochraneWork({
    DOI: "10.1002/example",
    title: ["Exercise for chronic low back pain"],
    "container-title": ["Cochrane Database of Systematic Reviews"],
    published: { "date-parts": [[2022]] },
  });

  assert.equal(normalized.source_name, "Cochrane via Crossref");
  assert.equal(normalized.study_type, "systematic review");
  assert.equal(normalized.year, 2022);
});

test("simplifyPubMedQuery elimina sintaxis booleana problemática", () => {
  assert.equal(
    simplifyPubMedQuery(
      '("chronic low back pain" AND exercise) OR rehabilitation[Title]'
    ),
    "chronic low back pain exercise rehabilitation"
  );
});

test("PubMed reintenta con una consulta simplificada cuando la primera no devuelve resultados", async () => {
  const originalFetch = global.fetch;
  const requestedUrls = [];

  global.fetch = async (url) => {
    requestedUrls.push(String(url));

    if (requestedUrls.length === 1) {
      return new Response(
        JSON.stringify({ esearchresult: { idlist: [] } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (requestedUrls.length === 2) {
      return new Response(
        JSON.stringify({ esearchresult: { idlist: ["12345"] } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      `<PubmedArticleSet>
        <PubmedArticle>
          <MedlineCitation>
            <PMID>12345</PMID>
            <Article>
              <ArticleTitle>Exercise therapy for chronic low back pain</ArticleTitle>
              <Abstract><AbstractText>Useful abstract.</AbstractText></Abstract>
              <Journal><Title>Journal of Physiotherapy</Title><JournalIssue><PubDate><Year>2024</Year></PubDate></JournalIssue></Journal>
              <PublicationTypeList><PublicationType>Systematic Review</PublicationType></PublicationTypeList>
            </Article>
          </MedlineCitation>
          <PubmedData><ArticleIdList><ArticleId IdType="doi">10.1000/test</ArticleId></ArticleIdList></PubmedData>
        </PubmedArticle>
      </PubmedArticleSet>`,
      { status: 200, headers: { "Content-Type": "application/xml" } }
    );
  };

  try {
    const articles = await searchPubMed(
      '("chronic low back pain" AND exercise)',
      10,
      { year_from: 2021 }
    );

    assert.equal(requestedUrls.length, 3);
    assert.equal(articles.length, 1);
    assert.equal(
      articles[0].source_name,
      "Journal of Physiotherapy"
    );
    assert.equal(
      articles[0].retrieval_source_name,
      "PubMed"
    );
    assert.equal(articles[0].pmid, "12345");
  } finally {
    global.fetch = originalFetch;
  }
});
