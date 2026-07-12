const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  sanitizeFinalClaim,
} = require("../src/services/researchAnswerFinalSafety");

test("softens plural clinically important exercise claims", () => {
  const result = sanitizeFinalClaim(
    {
      text: "Pilates y yoga muestran beneficios clínicamente importantes frente al control.",
    },
    "es"
  );

  assert.match(result.text, /pueden mejorar el dolor o la discapacidad/i);
  assert.doesNotMatch(result.text, /clínicamente importantes/i);
});

test("softens manual therapy incremental improvement claims", () => {
  const result = sanitizeFinalClaim(
    {
      text: "La terapia manual puede proporcionar mejorías adicionales a corto plazo.",
    },
    "es"
  );

  assert.match(result.text, /podría aportar beneficios a corto plazo/i);
  assert.match(result.text, /certeza varían entre estudios/i);
});

test("Research response normalizes Crossref database labels", () => {
  const routeSource = fs.readFileSync(
    path.join(__dirname, "../src/routes/research.js"),
    "utf8"
  );

  assert.match(routeSource, /function normalizeDatabaseName/);
  assert.match(routeSource, /normalized\.includes\("cochrane metadata"\)/);
  assert.match(routeSource, /return "Crossref"/);
});
