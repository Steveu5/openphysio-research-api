const test = require("node:test");
const assert = require("node:assert/strict");

const {
  localizeResearchArticle,
  localizeStableText,
} = require("../src/services/researchPresentationLocalization");

test("keeps Spanish Research presentation metadata unchanged", () => {
  const article = {
    evidence_level_label_es: "Estudio de cohorte",
    evidence_level_label_en: "Cohort study",
    ranking_reason: "Publicación reciente; Coincide con la condición",
  };

  assert.deepEqual(localizeResearchArticle(article, "es"), article);
});

test("localizes stable Research ranking metadata into native English", () => {
  assert.equal(
    localizeStableText(
      "Tema clínico central: condición + ejercicio; Publicación reciente; Coincide con la intervención",
      "en"
    ),
    "Direct clinical focus: condition + exercise; Recent publication; Matches the intervention"
  );
});

test("localizes evidence labels, PEDro labels, flags and limitations", () => {
  const localized = localizeResearchArticle(
    {
      evidence_level_label_es: "Ensayo clínico aleatorizado",
      evidence_level_label_en: "Randomized controlled trial",
      openphysio_priority_label: "Alta",
      pedro_score_label: "Moderada",
      ranking_reason: "Nivel de evidencia: Ensayo clínico aleatorizado",
      appraisal_flags: ["resumen disponible", "evidencia reciente"],
      caution_flags: ["limitaciones metodológicas reportadas"],
      query_relevance_flags: ["coincide con la condición consultada"],
      query_relevance_limitations: [
        "población no coincide claramente con la pregunta",
      ],
    },
    "en"
  );

  assert.equal(localized.evidence_level_label_es, "Randomized controlled trial");
  assert.equal(localized.openphysio_priority_label, "High");
  assert.equal(localized.pedro_score_label, "Moderate");
  assert.equal(
    localized.ranking_reason,
    "Evidence level: Randomized controlled trial"
  );
  assert.deepEqual(localized.appraisal_flags, [
    "abstract available",
    "recent evidence",
  ]);
  assert.deepEqual(localized.caution_flags, [
    "reported methodological limitations",
  ]);
  assert.deepEqual(localized.query_relevance_flags, [
    "matches the condition in the question",
  ]);
  assert.deepEqual(localized.query_relevance_limitations, [
    "population does not clearly match the question",
  ]);
});

test("uses existing English guideline scope metadata when available", () => {
  const localized = localizeResearchArticle(
    {
      guideline_scope_label_es: "Aplicación directa a la condición consultada",
      guideline_scope_label_en: "Directly applicable to the queried condition",
      guideline_scope_note_es: "La guía coincide directamente con la condición clínica consultada.",
      guideline_scope_note_en: "The guideline directly matches the queried clinical condition.",
    },
    "en"
  );

  assert.equal(
    localized.guideline_scope_label_es,
    "Directly applicable to the queried condition"
  );
  assert.equal(
    localized.guideline_scope_note_es,
    "The guideline directly matches the queried clinical condition."
  );
});
