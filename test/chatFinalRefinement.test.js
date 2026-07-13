const test = require("node:test");
const assert = require("node:assert/strict");

const {
  removeUnsupportedPrecision,
  refineStructuredClinicalChatFinal,
  renderConciseChatReply,
} = require("../src/services/chatFinalRefinement");

test("removes unsupported exact point estimates and strong wording", () => {
  const result = removeUnsupportedPrecision(
    "El ejercicio produce mejoras clínicamente relevantes (diferencia de 15 puntos en dolor y 10 puntos en función).",
    "es"
  );

  assert.doesNotMatch(result, /15 puntos|10 puntos/i);
  assert.doesNotMatch(result, /clínicamente relevantes/i);
});

test("softens significant comparative benefit claims", () => {
  const refined = refineStructuredClinicalChatFinal(
    {
      brief_answer: [
        {
          text: "Modalidades como yoga y Pilates muestran beneficios significativos frente a la atención habitual.",
          source_indices: [3],
        },
      ],
      clinical_application: [],
      assessment_considerations: [],
      precautions: [],
      confidence: { score: 80, level: "Alto", level_key: "high" },
    },
    [{ query_relevance_score: 90, evidence_level_rank: 8 }],
    "es"
  );

  assert.match(refined.brief_answer[0].text, /pueden mejorar algunos resultados/i);
  assert.doesNotMatch(refined.brief_answer[0].text, /beneficios significativos/i);
});

test("limits Chat sections and caps confidence", () => {
  const claim = (text, source = 1) => ({ text, source_indices: [source] });
  const refined = refineStructuredClinicalChatFinal(
    {
      brief_answer: [claim("Uno"), claim("Dos"), claim("Tres")],
      clinical_application: [
        claim("A"),
        claim("B"),
        claim("C"),
        claim("D"),
        claim("E"),
      ],
      assessment_considerations: [claim("F"), claim("G"), claim("H"), claim("I")],
      precautions: [claim("J"), claim("K"), claim("L")],
      confidence: { score: 96, level: "Alto", level_key: "high" },
    },
    [
      { query_relevance_score: 90, evidence_level_rank: 8 },
      { query_relevance_score: 85, evidence_level_rank: 8 },
    ],
    "es"
  );

  assert.equal(refined.brief_answer.length, 2);
  assert.equal(refined.clinical_application.length, 4);
  assert.equal(refined.assessment_considerations.length, 3);
  assert.equal(refined.precautions.length, 2);
  assert.equal(refined.confidence.score, 88);
});

test("renders a concise answer without duplicating a source list", () => {
  const reply = renderConciseChatReply(
    {
      brief_answer: [{ text: "Respuesta", source_indices: [2, 1] }],
      clinical_application: [{ text: "Aplicación", source_indices: [1] }],
      assessment_considerations: [],
      precautions: [],
      confidence: { level: "Alto", score: 88, rationale: "Razonamiento." },
    },
    "es"
  );

  assert.match(reply, /Respuesta clínica/);
  assert.match(reply, /\[1,2\]/);
  assert.doesNotMatch(reply, /Fuentes usadas|Sources used/);
});
