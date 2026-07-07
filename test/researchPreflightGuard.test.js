const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const {
  isResearchSearchRequest,
  isResearchSearchPreflight,
} = require("../src/middleware/isResearchSearchRequest");

function loadGuardWithHandle(handle) {
  const guardPath = require.resolve(
    "../src/middleware/researchPreflightGuard"
  );
  delete require.cache[guardPath];
  express.application.handle = handle;
  require(guardPath);
}

test("classifies only POST as a research search request", () => {
  assert.equal(
    isResearchSearchRequest({
      method: "POST",
      originalUrl: "/research/search",
    }),
    true
  );
  assert.equal(
    isResearchSearchRequest({
      method: "OPTIONS",
      originalUrl: "/research/search",
    }),
    false
  );
});

test("classifies research search OPTIONS as preflight", () => {
  assert.equal(
    isResearchSearchPreflight({
      method: "OPTIONS",
      originalUrl: "/research/search?source=pubmed",
    }),
    true
  );
  assert.equal(
    isResearchSearchPreflight({
      method: "OPTIONS",
      originalUrl: "/research/version",
    }),
    false
  );
});

test("rewrites research search preflight before the diagnostics handle", () => {
  const originalHandle = express.application.handle;
  let receivedUrl = null;

  try {
    loadGuardWithHandle((req) => {
      receivedUrl = req.originalUrl;
      return "handled";
    });

    const result = express.application.handle(
      {
        method: "OPTIONS",
        originalUrl: "/research/search",
      },
      {},
      () => {}
    );

    assert.equal(result, "handled");
    assert.equal(receivedUrl, "/__openphysio_cors_preflight__");
  } finally {
    express.application.handle = originalHandle;
  }
});

test("leaves POST research search requests unchanged", () => {
  const originalHandle = express.application.handle;
  let receivedUrl = null;

  try {
    loadGuardWithHandle((req) => {
      receivedUrl = req.originalUrl;
      return "handled";
    });

    express.application.handle(
      {
        method: "POST",
        originalUrl: "/research/search",
      },
      {},
      () => {}
    );

    assert.equal(receivedUrl, "/research/search");
  } finally {
    express.application.handle = originalHandle;
  }
});
