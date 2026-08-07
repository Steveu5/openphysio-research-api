const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  calculateEvidenceConfidence,
  renderResearchReply,
  renderChatReply,
} = require("../src/services/structuredEvidenceResponse");

function article(overrides = {}) {
  return {
    title: "Exercise therapy for chronic low back pain",
    year: 2025,
    abstract: "A systematic review reporting pain and disability outcomes.",
    evidence_level: "systematic_review_meta_analysis",
    evidence_level_rank: 9,
    query_relevance_score: 82,
    openphysio_evidence_score: 84,
    reading_priority_score: 83,
    ...overrides,
  };
}

test("confidence is calculated deterministically from evidence metadata", () => {
  const confidence = calculateEvidenceConfidence(
    [article(), article({ title: "Clinical practice guideline", evidence_level: "clinical_practice_guideline" })],
    "es"
  );

  assert.equal(confidence.level_key, "high");
  assert.ok(confidence.score >= 75);
  assert.equal(confidence.metrics.strong_direct_articles, 2);
});

test("confidence is limited when no article directly matches the question", () => {
  const confidence = calculateEvidenceConfidence(
    [
      article({ query_relevance_score: 20 }),
      article({ query_relevance_score: 30, evidence_level_rank: 4 }),
    ],
    "es"
  );

  assert.equal(confidence.level_key, "limited");
  assert.ok(confidence.score <= 42);
});

test("Research rendering keeps numeric citations beside claims", () => {
  const confidence = {
    level: "Moderado",
    level_key: "moderate",
    score: 64,
    rationale: "Evidencia directa con algunas limitaciones.",
  };
  const reply = renderResearchReply(
    {
      clinical_answer: [],
      key_findings: [
        { text: "El ejercicio mostró resultados favorables en los estudios recuperados.", source_indices: [1, 2] },
      ],
      evidence_relationships: [
        { text: "Los resultados fueron consistentes en dirección, con diferencias metodológicas.", source_indices: [1, 2] },
      ],
      consistency_level: "moderate",
      reading_path: [],
      uncertainties: ["La dosis óptima no está clara."],
      methodological_caution: "Se requiere lectura crítica.",
      confidence,
    },
    "es"
  );

  assert.match(reply, /El ejercicio mostró resultados favorables en los estudios recuperados\. \[1,2\]/);
  assert.match(reply, /Confianza de la evidencia: Moderado \(64\/100\)/);
  assert.doesNotMatch(reply, /Respuesta clínica|Ruta de lectura/);
  assert.match(reply, /La dosis óptima no está clara/);
});

test("Chat rendering aligns inline citations and the visible source legend", () => {
  const confidence = {
    level: "Moderado",
    level_key: "moderate",
    score: 61,
    rationale: "La evidencia es directa, pero limitada.",
  };
  const reply = renderChatReply(
    {
      brief_answer: [
        { text: "La carga progresiva es razonable.", source_indices: [1] },
      ],
      clinical_application: [],
      assessment_considerations: [],
      precautions: [],
      confidence,
    },
    [article()],
    "es"
  );

  assert.match(reply, /La carga progresiva es razonable\. \[1\]/);
  assert.match(reply, /\[1\] Exercise therapy for chronic low back pain \(2025\)/);
});

test("routes expose structured response, confidence, and citation style", () => {
  const root = path.join(__dirname, "..");
  const researchRoute = fs.readFileSync(
    path.join(root, "src/routes/research.js"),
    "utf8"
  );
  const chatRoute = fs.readFileSync(
    path.join(root, "src/routes/chat.js"),
    "utf8"
  );

  for (const source of [researchRoute, chatRoute]) {
    assert.match(source, /structuredResponse/);
    assert.match(source, /confidence/);
    assert.match(source, /numeric_source_index/);
  }

  assert.match(researchRoute, /useCache: false/);
  assert.match(researchRoute, /researchResponseStructureVersion: "2\.0\.0"/);
  assert.match(chatRoute, /slice\(0, 4\)/);
});

test("prompts explicitly prevent the model from changing backend confidence", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/services/structuredEvidenceResponse.js"),
    "utf8"
  );

  assert.match(source, /confidence object is calculated by the backend/);
  assert.match(source, /MUST NOT be changed/);
  assert.match(source, /source_indices may only contain/);
});
