const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyResearchNarrativeTranslations,
  detectQueryLanguage,
  isResearchNarrativeLanguageCompliant,
  resolveResearchResponseLanguage,
} = require("../src/services/researchResponseLanguage");

test("detects Spanish and English clinical questions", () => {
  assert.equal(
    detectQueryLanguage("Dolor lumbar crónico y ejercicio"),
    "es"
  );
  assert.equal(
    detectQueryLanguage("¿Qué ejercicio ayuda en la tendinopatía aquílea?"),
    "es"
  );
  assert.equal(
    detectQueryLanguage("Chronic low back pain and exercise"),
    "en"
  );
  assert.equal(
    detectQueryLanguage("What is the evidence for exercise after ACL injury?"),
    "en"
  );
});

test("the question language takes priority over the interface language", () => {
  assert.equal(
    resolveResearchResponseLanguage({
      query: "Dolor lumbar crónico y ejercicio",
      requestedLanguage: "en",
      intent: { language: "en" },
    }),
    "es"
  );
  assert.equal(
    resolveResearchResponseLanguage({
      query: "Chronic low back pain and exercise",
      requestedLanguage: "es",
      intent: { language: "es" },
    }),
    "en"
  );
});

test("uses the interface language only for an ambiguous query", () => {
  assert.equal(
    resolveResearchResponseLanguage({
      query: "ACL",
      requestedLanguage: "es",
      intent: {},
    }),
    "es"
  );
  assert.equal(
    resolveResearchResponseLanguage({
      query: "ACL",
      requestedLanguage: "en",
      intent: {},
    }),
    "en"
  );
});

test("detects a Research narrative returned in the wrong language", () => {
  const english = {
    key_findings: [
      {
        text: "Exercise therapy improves pain and disability in chronic low back pain.",
        source_indices: [1, 2],
      },
    ],
    uncertainties: ["The optimal exercise dose remains uncertain."],
  };

  assert.equal(isResearchNarrativeLanguageCompliant(english, "en"), true);
  assert.equal(isResearchNarrativeLanguageCompliant(english, "es"), false);
});

test("applies translations without changing citations or confidence", () => {
  const original = {
    key_findings: [
      { text: "Exercise improves pain.", source_indices: [1, 3] },
    ],
    evidence_relationships: [
      { text: "The studies broadly agree.", source_indices: [1, 2, 3] },
    ],
    uncertainties: ["Dose remains uncertain."],
    methodological_caution: "Full critical appraisal is required.",
    confidence: { level: "Alto", score: 82 },
  };
  const translated = applyResearchNarrativeTranslations(original, [
    { id: "key_findings.0", text: "El ejercicio mejora el dolor." },
    {
      id: "evidence_relationships.0",
      text: "Los estudios coinciden de forma general.",
    },
    { id: "uncertainties.0", text: "La dosis sigue siendo incierta." },
    {
      id: "methodological_caution",
      text: "Se requiere una evaluación crítica completa.",
    },
  ]);

  assert.equal(translated.key_findings[0].text, "El ejercicio mejora el dolor.");
  assert.deepEqual(translated.key_findings[0].source_indices, [1, 3]);
  assert.deepEqual(translated.evidence_relationships[0].source_indices, [1, 2, 3]);
  assert.deepEqual(translated.confidence, original.confidence);
  assert.equal(isResearchNarrativeLanguageCompliant(translated, "es"), true);
});
