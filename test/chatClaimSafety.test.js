const test = require("node:test");
const assert = require("node:assert/strict");

const {
  sanitizeClinicalApplicationItems,
  sanitizeAssessmentItems,
  sanitizeStructuredChatResponse,
} = require("../src/services/chatClaimSafety");

test("softens imperative clinical application wording", () => {
  const result = sanitizeClinicalApplicationItems(
    [
      {
        text: "Prescribir ejercicio terapéutico supervisado y considerar yoga como opción efectiva.",
        source_indices: [1, 2],
      },
    ],
    "es"
  );

  assert.match(result[0].text, /^Considerar ejercicio terapéutico/i);
  assert.match(result[0].text, /opción posible/i);
  assert.doesNotMatch(result[0].text, /^Prescribir/i);
});

test("removes unsupported named questionnaires and duration thresholds", () => {
  const result = sanitizeAssessmentItems(
    [
      {
        text: "Determinar la tolerancia a la carga y la función mediante cuestionarios validados (p. ej., Oswestry, Roland-Morris).",
        source_indices: [],
      },
      {
        text: "Evaluar la irritabilidad y cronicidad del dolor (>12 semanas).",
        source_indices: [],
      },
    ],
    "es"
  );

  const text = result.map((item) => item.text).join(" ");
  assert.doesNotMatch(text, /Oswestry|Roland-Morris|>12 semanas/i);
  assert.match(text, /tolerancia a la carga|irritabilidad/i);
});

test("structured sanitizer applies application and assessment safety together", () => {
  const result = sanitizeStructuredChatResponse(
    {
      clinical_application: [
        { text: "Prescribir ejercicio terapéutico.", source_indices: [1] },
      ],
      assessment_considerations: [
        { text: "Valorar función con Oswestry.", source_indices: [] },
      ],
      precautions: [],
      confidence: { level_key: "high" },
    },
    { language: "es", confidence: { level_key: "high" } }
  );

  assert.doesNotMatch(result.clinical_application[0].text, /^Prescribir/i);
  assert.doesNotMatch(
    result.assessment_considerations.map((item) => item.text).join(" "),
    /Oswestry/i
  );
});
