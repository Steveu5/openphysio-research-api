const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getAllowedOrigins,
  isOriginAllowed,
  normalizeOrigin,
} = require("../src/config/corsOrigins");

test("normalizes trailing slashes and casing", () => {
  assert.equal(
    normalizeOrigin(" HTTPS://APP.OPENPHYSIOHUB.COM/ "),
    "https://app.openphysiohub.com"
  );
});

test("includes the canonical production app origin", () => {
  const origins = getAllowedOrigins({ ALLOWED_ORIGINS: "" });
  assert.equal(origins.includes("https://app.openphysiohub.com"), true);
});

test("accepts configured origins with a trailing slash", () => {
  const origins = getAllowedOrigins({
    ALLOWED_ORIGINS: "https://staging.openphysiohub.com/",
  });

  assert.equal(
    isOriginAllowed("https://staging.openphysiohub.com", origins),
    true
  );
});

test("rejects origins that are not configured", () => {
  const origins = getAllowedOrigins({ ALLOWED_ORIGINS: "" });
  assert.equal(isOriginAllowed("https://other-site.test", origins), false);
});
