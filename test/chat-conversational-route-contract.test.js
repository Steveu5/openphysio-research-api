const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const route = fs.readFileSync(
  path.join(__dirname, "..", "src", "routes", "chat.js"),
  "utf8"
);

test("chat handles social messages before scientific retrieval", () => {
  const conversationalGuard = route.indexOf(
    "const conversationalResponse = buildConversationalChatResponse"
  );
  const scientificRetrieval = route.indexOf(
    "const evidence = await searchEvidence"
  );

  assert.notEqual(conversationalGuard, -1);
  assert.notEqual(scientificRetrieval, -1);
  assert.ok(conversationalGuard < scientificRetrieval);
});

test("the conversational path preserves quota and system metadata contracts", () => {
  assert.match(route, /\.\.\.conversationalResponse/);
  assert.match(route, /researchSystem: getResearchSystemMetadata\(\)/);
  assert.match(route, /quota: quotaReservation\.quota/);
});
