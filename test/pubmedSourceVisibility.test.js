const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  runWithSourceDiagnostics,
  recordSourceDiagnostic,
} = require("../src/services/sourceDiagnosticsContext");

test("source diagnostics remain scoped to one Research request", async () => {
  const first = await runWithSourceDiagnostics(async () => {
    recordSourceDiagnostic("pubmed", {
      label: "PubMed",
      status: "ok",
      retrieved_count: 6,
    });
    return "done";
  });

  const second = await runWithSourceDiagnostics(async () => "empty");

  assert.equal(first.result, "done");
  assert.equal(first.diagnostics.length, 1);
  assert.equal(first.diagnostics[0].source, "pubmed");
  assert.equal(first.diagnostics[0].status, "ok");
  assert.equal(first.diagnostics[0].retrieved_count, 6);
  assert.deepEqual(second.diagnostics, []);
});

test("multiple PubMed calls are aggregated and partial failures stay visible", async () => {
  const run = await runWithSourceDiagnostics(async () => {
    recordSourceDiagnostic("pubmed", {
      label: "PubMed",
      status: "ok",
      retrieved_count: 5,
      duration_ms: 300,
    });
    recordSourceDiagnostic("pubmed", {
      label: "PubMed",
      status: "error",
      retrieved_count: 0,
      duration_ms: 800,
      error: "timeout",
    });
  });

  assert.equal(run.diagnostics.length, 1);
  assert.equal(run.diagnostics[0].status, "partial");
  assert.equal(run.diagnostics[0].retrieved_count, 5);
  assert.equal(run.diagnostics[0].requests, 2);
  assert.equal(run.diagnostics[0].duration_ms, 800);
  assert.match(run.diagnostics[0].error, /timeout/);
});

test("PubMed records success empty and error states", () => {
  const root = path.join(__dirname, "..");
  const pubmed = fs.readFileSync(
    path.join(root, "src/services/pubmed.js"),
    "utf8"
  );

  assert.match(pubmed, /recordSourceDiagnostic\("pubmed"/);
  assert.match(pubmed, /status: filteredArticles\.length > 0 \? "ok" : "empty"/);
  assert.match(pubmed, /status: "error"/);
  assert.match(pubmed, /duration_ms/);
});

test("Research exposes PubMed diagnostics in the response", () => {
  const root = path.join(__dirname, "..");
  const research = fs.readFileSync(
    path.join(root, "src/routes/research.js"),
    "utf8"
  );

  assert.match(research, /runWithSourceDiagnostics/);
  assert.match(research, /sourceDiagnostics/);
  assert.match(research, /sourceDiagnosticsVersion: "2\.1\.0"/);
  assert.match(research, /buildSourceDiagnostics/);
  assert.match(research, /displayedArticles:\s*selectedArticles/);
});
