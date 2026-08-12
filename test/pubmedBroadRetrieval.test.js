const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildProfessionalPubMedQuery,
  filterProfessionalArticles,
} = require("../src/services/trustedSources");

test("general PubMed queries are not restricted to a short journal whitelist", () => {
  const query = "chronic low back pain AND exercise therapy";
  const built = buildProfessionalPubMedQuery(query);

  assert.equal(built, query);
  assert.doesNotMatch(built, /J Orthop Sports Phys Ther/);
  assert.doesNotMatch(built, /Cochrane Database Syst Rev/);
});

test("PubMed keeps relevant articles from journals outside the preferred list", () => {
  const articles = filterProfessionalArticles([
    {
      source_name: "PubMed",
      pmid: "123",
      title: "Exercise therapy for chronic low back pain",
      journal: "European Spine Journal",
    },
  ]);

  assert.equal(articles.length, 1);
  assert.equal(articles[0].pmid, "123");
  assert.equal(articles[0].retrieval_source_name, "PubMed");
  assert.equal(articles[0].source_name, "PubMed");
  assert.equal(articles[0].professional_source_score, 0);
});

test("preferred journals are still labeled and boosted without excluding other PubMed evidence", () => {
  const articles = filterProfessionalArticles([
    {
      source_name: "PubMed",
      pmid: "456",
      title: "Neck Pain: Revision 2017",
      journal: "Journal of Orthopaedic & Sports Physical Therapy",
    },
  ]);

  assert.equal(articles.length, 1);
  assert.equal(articles[0].source_name, "JOSPT");
  assert.equal(articles[0].retrieval_source_name, "PubMed");
  assert.ok(articles[0].professional_source_score > 0);
});

test("Research forces a live search so old narrow PubMed cache does not survive", () => {
  const research = fs.readFileSync(
    path.join(__dirname, "../src/routes/research.js"),
    "utf8"
  );

  assert.match(research, /useCache: false/);
  assert.match(research, /pubmedSearchScopeVersion: "2\.2\.0"/);
  assert.match(research, /sourceDiagnosticsVersion: "2\.1\.0"/);
});
