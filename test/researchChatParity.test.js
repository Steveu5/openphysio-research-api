const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const route = fs.readFileSync(
  path.resolve(__dirname, '../src/routes/research.js'),
  'utf8'
);

test('Research uses the same evidence selection pipeline as Chat', () => {
  assert.match(route, /searchEvidence\(/);
  assert.match(route, /selectEvidenceForResponse\(/);
  assert.match(route, /refineResearchResultsFinal\(/);
});

test('Research applies the Chat Library integration without condition-specific filters', () => {
  assert.match(route, /attachLibraryResourcesToCitations\(/);
  assert.doesNotMatch(route, /isBroadKneeQuestion|eligibleLibraryGuides/);
  assert.match(route, /libraryGuideIntegrationVersion: "2\.0\.0"/);
});

test('Research returns before secondary cache persistence finishes', () => {
  assert.match(route, /void setCache\(/);
  assert.match(route, /Research cache persistence delayed/);
});
