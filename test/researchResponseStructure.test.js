const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../src/services/structuredEvidenceResponse.js"),
  "utf8"
);

test("Research renders scientific findings without a duplicate clinical answer", () => {
  const researchRenderer = source.slice(
    source.indexOf("function renderResearchReply"),
    source.indexOf("async function generateStructuredResearchAnswer")
  );

  assert.match(researchRenderer, /Hallazgos científicos/);
  assert.match(researchRenderer, /Consistencia entre estudios/);
  assert.match(researchRenderer, /Límites de la evidencia/);
  assert.doesNotMatch(researchRenderer, /Respuesta clínica/);
  assert.doesNotMatch(researchRenderer, /Ruta de lectura/);
});

test("Research prompt requests cross-study findings and forbids clinical prescriptions", () => {
  assert.match(source, /Research is not Clinical Chat/);
  assert.match(source, /3 to 5 distinct cross-study findings/);
  assert.match(source, /do not create a reading path/);
  assert.match(source, /consistency_level/);
});
