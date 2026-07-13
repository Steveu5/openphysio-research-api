const test = require("node:test");
const assert = require("node:assert/strict");

const {
  removeUnsupportedPrecision,
  refineStructuredClinicalChatFinal,
  renderConciseChatReply,
  buildEvidenceRelationship,
  buildFollowUpQuestion,
  buildChatEvidenceSynthesisLine,
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

test("limits Chat sections, relates evidence and adds one follow-up question", () => {
  const claim = (text, source = 1) => ({ text, source_indices: [source] });
  const articles = [
    {
      study_type: "clinical practice guideline",
      query_relevance_score: 90,
      evidence_level_rank: 10,
    },
    {
      study_type: "systematic review and meta-analysis",
      query_relevance_score: 85,
      evidence_level_rank: 8,
    },
    {
      study_type: "randomized clinical trial",
      query_relevance_score: 80,
      evidence_level_rank: 6,
    },
  ];
  const refined = refineStructuredClinicalChatFinal(
    {
      brief_answer: [claim("Uno"), claim("Dos"), claim("Tres")],
      clinical_application: [
        claim("A"),
        claim("B"),
        claim("C"),
        claim("D"),
      ],
      assessment_considerations: [claim("F"), claim("G"), claim("H")],
      precautions: [claim("J"), claim("K"), claim("L")],
      confidence: { score: 96, level: "Alto", level_key: "high" },
    },
    articles,
    "es",
    {
      question: "¿Qué recomienda la evidencia para dolor lumbar crónico?",
      intent: { condition: "dolor lumbar crónico" },
    }
  );

  assert.equal(refined.brief_answer.length, 2);
  assert.equal(refined.clinical_application.length, 3);
  assert.equal(refined.assessment_considerations.length, 2);
  assert.equal(refined.precautions.length, 2);
  assert.equal(refined.evidence_relationships.length, 1);
  assert.match(refined.follow_up_question, /qué limita más al paciente/i);
  assert.equal(refined.confidence.score, 88);
});

test("describes how guideline, reviews and trials relate", () => {
  const relationship = buildEvidenceRelationship(
    [
      { study_type: "clinical practice guideline" },
      { study_type: "systematic review" },
      { study_type: "randomized clinical trial" },
    ],
    "es"
  );

  assert.match(relationship.text, /La guía aporta el marco clínico general/);
  assert.deepEqual(relationship.source_indices, [1, 2, 3]);
});

test("builds a multi-source synthesis line instead of a guide-only basis", () => {
  const line = buildChatEvidenceSynthesisLine(
    [
      { study_type: "clinical practice guideline" },
      { study_type: "systematic review" },
      { study_type: "randomized clinical trial" },
    ],
    "es"
  );

  assert.match(line, /integra una guía clínica con revisiones sistemáticas/i);
  assert.match(line, /no se utiliza como fuente exclusiva/i);
  assert.match(line, /\[1,2,3\]/);
});

test("renders relationships and the final clinical question without a source list", () => {
  const reply = renderConciseChatReply(
    {
      brief_answer: [{ text: "Respuesta", source_indices: [2, 1] }],
      evidence_relationships: [
        { text: "Relación entre fuentes", source_indices: [1, 2] },
      ],
      clinical_application: [{ text: "Aplicación", source_indices: [1] }],
      assessment_considerations: [],
      precautions: [],
      confidence: { level: "Alto", score: 88, rationale: "Razonamiento." },
      follow_up_question: buildFollowUpQuestion(
        "dolor lumbar crónico",
        {},
        "es"
      ),
    },
    "es"
  );

  assert.match(reply, /Respuesta clínica/);
  assert.match(reply, /Cómo se relaciona la evidencia/);
  assert.match(reply, /Para continuar/);
  assert.match(reply, /\[1,2\]/);
  assert.doesNotMatch(reply, /Fuentes usadas|Sources used/);
});
