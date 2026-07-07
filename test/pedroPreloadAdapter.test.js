const test = require("node:test");
const assert = require("node:assert/strict");

const storedPedroScores = require("../src/services/storedPedroScores");

test("PEDro preload adapter resolves immediately while refresh continues", async () => {
  const adapterPath = require.resolve(
    "../src/middleware/pedroPreloadAdapter"
  );
  const originalLoader = storedPedroScores.ensureStoredPedroScoresLoaded;
  let releaseRefresh;
  let refreshStarted = false;

  storedPedroScores.ensureStoredPedroScoresLoaded = () => {
    refreshStarted = true;
    return new Promise((resolve) => {
      releaseRefresh = resolve;
    });
  };

  delete require.cache[adapterPath];
  require(adapterPath);

  try {
    const result = await storedPedroScores.ensureStoredPedroScoresLoaded();

    assert.equal(result, 0);
    await Promise.resolve();
    assert.equal(refreshStarted, true);

    releaseRefresh(1);
  } finally {
    storedPedroScores.ensureStoredPedroScoresLoaded = originalLoader;
    delete require.cache[adapterPath];
  }
});
