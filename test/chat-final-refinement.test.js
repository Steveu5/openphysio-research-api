const test = require("node:test");
const assert = require("node:assert/strict");

const {
  renderConciseChatReply,
  normalizeSpanishClinicalTone,
  stripTrailingCitationGroups,
  collapseDuplicateAdjacentCitations,
  removeUnsupportedPrecision,
  isCervicogenicHeadacheContext,
  refineStructuredClinicalChatFinal,
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

test("Chat removes research-style exact effect estimates from concise clinical text", () => {
  assert.equal(
    removeUnsupportedPrecision(
      "La prevalencia fue significativamente mayor en CGH (OR 3.64; IC 95% 1.35-9.84).",
      "es"
    ),
    "La prevalencia fue mayor en CGH."
  );
});

test("cervicogenic headache guard treats the neck guideline as related framework", () => {
  assert.equal(
    isCervicogenicHeadacheContext("Dolor cervical asociado a cefalea cervicogénica"),
    true
  );

  const refined = refineStructuredClinicalChatFinal(
    {
      brief_answer: [
        {
          text: "La CGH se asocia con TMD (OR 3.64; IC 95% 1.35-9.84).",
          source_indices: [3],
        },
        {
          text: "La combinación de terapia manual y ejercicio muestra evidencia de alta calidad para alivio a corto plazo.",
          source_indices: [4],
        },
      ],
      clinical_application: [
        {
          text: "Evaluar ATM como prioridad principal.",
          source_indices: [3],
        },
      ],
      confidence: {
        level: "Alto",
        score: 88,
        rationale: "Confianza alta.",
      },
    },
    [
      {
        title: "Neck Pain: Revision 2017",
        study_type: "Clinical Practice Guideline",
        evidence_level_rank: 9,
        query_relevance_score: 70,
      },
      {
        title: "Temporomandibular Disorders and Orofacial Outcomes in Subjects with Neck Pain and/or Cervicogenic Headache",
        study_type: "Systematic Review and Meta-analysis",
        evidence_level_rank: 8,
        query_relevance_score: 68,
      },
      {
        title: "Manual therapy and exercise for neck pain",
        study_type: "Systematic Review",
        evidence_level_rank: 8,
        query_relevance_score: 66,
      },
    ],
    "es",
    {
      question: "Dolor cervical asociado a cefalea cervicogénica",
      intent: { condition: "cefalea cervicogénica" },
    }
  );

  const reply = renderConciseChatReply(refined, "es");
  assert.equal(refined.confidence.level, "Moderado");
  assert.ok(refined.confidence.score <= 78);
  assert.match(reply, /marco clínico relacionado/);
  assert.match(reply, /no sustituye la evidencia específica/);
  assert.match(reply, /temporomandibular solo si hay dolor orofacial/);
  assert.doesNotMatch(reply, /OR 3\.64/);
  assert.doesNotMatch(reply, /alta calidad/);
});
