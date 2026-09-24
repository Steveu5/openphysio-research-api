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
  // Greetings are free: usage is reported, but no unit is reserved first.
  assert.match(route, /quota: usage \? legacyQuota\(usage\) : undefined/);
  assert.ok(
    route.indexOf("buildConversationalChatResponse(") < route.indexOf("reserveUsage("),
    "the conversational shortcut must run before any usage reservation"
  );
});
