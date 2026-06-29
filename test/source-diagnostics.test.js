const test = require("node:test");
const assert = require("node:assert/strict");

const {
  identifySource,
  toPublicDiagnostic,
} = require("../src/middleware/sourceDiagnostics");

test("identifica PubMed, Europe PMC y Cochrane", () => {
  assert.equal(
    identifySource(
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed"
    )?.id,
    "pubmed"
  );

  assert.equal(
    identifySource(
      "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
    )?.id,
    "europe_pmc"
  );

  assert.equal(
    identifySource(
      "https://api.crossref.org/works?query.container-title=Cochrane"
    )?.id,
    "cochrane"
  );
});

test("clasifica una fuente correcta con resultados", () => {
  const diagnostic = toPublicDiagnostic({
    source: "pubmed",
    label: "PubMed",
    requests: 2,
    successful_requests: 2,
    failed_requests: 0,
    retrieved_count: 12,
    duration_ms: 450,
  });

  assert.equal(diagnostic.status, "success");
  assert.equal(diagnostic.retrieved_count, 12);
});

test("clasifica recuperación parcial y error temporal", () => {
  const partial = toPublicDiagnostic({
    source: "europe_pmc",
    label: "Europe PMC",
    requests: 2,
    successful_requests: 1,
    failed_requests: 1,
    retrieved_count: 4,
    duration_ms: 800,
  });

  const failed = toPublicDiagnostic({
    source: "cochrane",
    label: "Cochrane",
    requests: 2,
    successful_requests: 0,
    failed_requests: 2,
    retrieved_count: 0,
    duration_ms: 1000,
  });

  assert.equal(partial.status, "partial");
  assert.equal(failed.status, "error");
});

test("clasifica respuesta correcta sin registros como vacía", () => {
  const diagnostic = toPublicDiagnostic({
    source: "cochrane",
    label: "Cochrane",
    requests: 1,
    successful_requests: 1,
    failed_requests: 0,
    retrieved_count: 0,
    duration_ms: 200,
  });

  assert.equal(diagnostic.status, "empty");
});
