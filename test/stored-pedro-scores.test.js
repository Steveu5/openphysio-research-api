const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeDoi,
  normalizeTitle,
  buildArticleKeys,
  indexStoredPedroRows,
  enrichArticleWithStoredPedroScore,
  replaceStoredPedroIndexForTests,
} = require("../src/services/storedPedroScores");
const {
  calculateOpenPhysioEvidenceScore,
} = require("../src/services/evidenceScoring");

test("normaliza DOI y títulos para recuperar PEDro", () => {
  assert.equal(
    normalizeDoi("https://doi.org/10.1000/ABC.123"),
    "10.1000/abc.123"
  );

  assert.equal(
    normalizeTitle("Ejercicio terapéutico: ensayo clínico"),
    "ejercicio terapeutico ensayo clinico"
  );
});

test("prioriza DOI, PMID y PMCID como claves estables", () => {
  const keys = buildArticleKeys({
    doi: "10.1000/test",
    pmid: "12345",
    pmcid: "PMC999",
    title: "A randomized controlled trial",
    year: 2024,
  });

  assert.deepEqual(keys.slice(0, 3), [
    "doi:10.1000/test",
    "pmid:12345",
    "pmcid:pmc999",
  ]);
});

test("descarta puntuaciones PEDro inválidas al construir el índice", () => {
  const index = indexStoredPedroRows([
    {
      doi: "10.1000/valid",
      pedro_score: 8,
    },
    {
      doi: "10.1000/missing",
      pedro_score: null,
    },
  ]);

  assert.equal(index.get("doi:10.1000/valid")?.score, 8);
  assert.equal(index.has("doi:10.1000/missing"), false);
});

test("enriquece el ensayo antes del cálculo de calidad", () => {
  replaceStoredPedroIndexForTests([
    {
      id: "stored-article",
      doi: "10.1000/rct",
      title: "Exercise therapy randomized controlled trial",
      year: 2024,
      pedro_score: 8,
    },
  ]);

  const trial = {
    doi: "https://doi.org/10.1000/RCT",
    title: "Exercise therapy randomized controlled trial",
    abstract: "Patients received exercise therapy in a randomized trial.",
    study_type: "Randomized Controlled Trial",
    evidence_level: "randomized_controlled_trial",
    evidence_level_rank: 7,
    journal: "Journal of Physiotherapy",
    year: 2024,
  };

  const withoutPedro = calculateOpenPhysioEvidenceScore(trial);
  const enriched = enrichArticleWithStoredPedroScore(trial);
  const withPedro = calculateOpenPhysioEvidenceScore(enriched);

  assert.equal(enriched.pedro_score, 8);
  assert.equal(enriched.pedro_score_source, "supabase_confirmed");
  assert.equal(withPedro.pedro_score_status, "confirmed_or_imported");
  assert.equal(withPedro.pedro_quality_boost, 8);
  assert.ok(
    withPedro.openphysio_evidence_score >
      withoutPedro.openphysio_evidence_score
  );
});

test("no reemplaza una puntuación PEDro ya presente", () => {
  replaceStoredPedroIndexForTests([
    {
      doi: "10.1000/existing",
      pedro_score: 5,
    },
  ]);

  const enriched = enrichArticleWithStoredPedroScore({
    doi: "10.1000/existing",
    pedro_score: 9,
  });

  assert.equal(enriched.pedro_score, 9);
  assert.equal(enriched.pedro_score_source, "incoming");
});
