const test = require("node:test");
const assert = require("node:assert/strict");

const {
  renderConciseChatReply,
  normalizeSpanishClinicalTone,
  stripTrailingCitationGroups,
  collapseDuplicateAdjacentCitations,
} = require("../src/services/chatFinalRefinement");

test("rendered Chat claims do not duplicate numeric citations", () => {
  const reply = renderConciseChatReply(
    {
      brief_answer: [
        {
          text: "La evidencia respalda el ejercicio terapéutico. [1,2,3]",
          source_indices: [1, 2, 3],
        },
      ],
      clinical_application: [
        {
          text: "Considera ejercicio supervisado. [2,3]",
          source_indices: [2, 3],
        },
      ],
      confidence: {
        level: "Alto",
        score: 88,
        rationale: "Confianza alta para la orientación general.",
      },
    },
    "es"
  );

  assert.match(reply, /La evidencia respalda el ejercicio terapéutico\. \[1,2,3\]/);
  assert.match(reply, /Considera ejercicio supervisado\. \[2,3\]/);
  assert.doesNotMatch(reply, /\[1,2,3\]\s+\[1,2,3\]/);
  assert.doesNotMatch(reply, /\[2,3\]\s+\[2,3\]/);
});

test("Spanish clinical tone is normalized to the direct style used by the Chat", () => {
  assert.equal(
    normalizeSpanishClinicalTone("Combine el ejercicio con educación del paciente.", "es"),
    "Combina el ejercicio con educación del paciente."
  );
  assert.equal(
    normalizeSpanishClinicalTone("Evalúe la irritabilidad del dolor.", "es"),
    "Evalúa la irritabilidad del dolor."
  );
  assert.equal(
    normalizeSpanishClinicalTone("Valore la tolerancia a la carga.", "es"),
    "Valora la tolerancia a la carga."
  );
});

test("citation helpers clean repeated adjacent citation groups", () => {
  assert.equal(
    stripTrailingCitationGroups("Modalidades concretas pueden ayudar. [3] [3]"),
    "Modalidades concretas pueden ayudar."
  );
  assert.equal(
    collapseDuplicateAdjacentCitations("Texto clínico. [1,2,3] [1,2,3]"),
    "Texto clínico. [1,2,3]"
  );
});
