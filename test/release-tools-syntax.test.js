const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

function checkNodeSyntax(relativePath) {
  const output = execFileSync(
    process.execPath,
    ["--check", path.join(repoRoot, relativePath)],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  assert.equal(output, "");
}

test("production smoke tool has valid Node syntax", () => {
  checkNodeSyntax("tools/smoke-production.js");
});

test("production smoke auth helper has valid Node syntax", () => {
  checkNodeSyntax("tools/smoke-auth-token.js");
});

test("Library production audit tool has valid Node syntax", () => {
  checkNodeSyntax("tools/audit-library-production.js");
});
