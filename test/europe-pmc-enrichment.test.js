const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeEuropePmcResult,
  buildIdentifierClauses,
  needsMetadataEnrichment,
  mergeEuropePmcMetadata,
} = require("../src/services/europePmc");

test("normaliza resúmenes y metadatos de acceso completo", () => {
  const article = normalizeEuropePmcResult({
    id: "123",
    pmid: "123",
    pmcid: "PMC123",
    doi: "10.1000/test",
    title: "<b>Exercise therapy</b>",
    abstractText: "<p>Background:</p> Exercise improved function.",
    isOpenAccess: "Y",
    inEPMC: "Y",
  });

  assert.equal(article.title, "Exercise therapy");
  assert.equal(article.abstract, "Background: Exercise improved function.");
  assert.equal(article.abstract_source, "Europe PMC");
  assert.equal(article.full_text_available, true);
  assert.equal(
    article.full_text_url,
    "https://pmc.ncbi.nlm.nih.gov/articles/PMC123/"
  );
});

test("construye identificadores para búsquedas dirigidas", () => {
  const clauses = buildIdentifierClauses({
    pmid: "12345",
    pmcid: "PMC999",
    doi: "https://doi.org/10.1000/ABC",
  });

  assert.deepEqual(clauses, [
    "EXT_ID:12345",
    "PMCID:PMC999",
    'DOI:"10.1000/abc"',
  ]);
});

test("solo enriquece registros con información incompleta", () => {
  assert.equal(
    needsMetadataEnrichment({
      doi: "10.1000/test",
      abstract: "Short abstract",
      pmcid: null,
      open_access: null,
    }, 280),
    true
  );

  assert.equal(
    needsMetadataEnrichment({
      doi: "10.1000/test",
      abstract: "A".repeat(500),
      pmcid: "PMC123",
      open_access: true,
    }, 280),
    false
  );
});

test("conserva el resumen más completo y añade trazabilidad", () => {
  const merged = mergeEuropePmcMetadata(
    {
      title: "Exercise therapy",
      doi: "10.1000/test",
      abstract: "Short abstract.",
      source_name: "Cochrane via Crossref",
      raw_metadata: { source: "Crossref" },
    },
    {
      title: "Exercise therapy",
      doi: "10.1000/test",
      pmid: "12345",
      pmcid: "PMC123",
      abstract: "A much longer abstract describing methods, results, and conclusions.",
      open_access: true,
      full_text_available: true,
      full_text_url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC123/",
      full_text_source: "PubMed Central",
    }
  );

  assert.equal(merged.abstract_enriched, true);
  assert.equal(merged.abstract_source, "Europe PMC");
  assert.equal(merged.pmid, "12345");
  assert.equal(merged.pmcid, "PMC123");
  assert.equal(merged.open_access, true);
  assert.equal(
    merged.raw_metadata.europe_pmc_enrichment.abstract_replaced,
    true
  );
});
