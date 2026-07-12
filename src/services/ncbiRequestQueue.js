const { fetchWithRetry } = require("../utils/fetchWithRetry");

let queueTail = Promise.resolve();
let lastRequestStartedAt = 0;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function minimumIntervalMs() {
  return process.env.NCBI_API_KEY ? 120 : 380;
}

async function waitForNcbiSlot() {
  const elapsed = Date.now() - lastRequestStartedAt;
  const waitMs = Math.max(0, minimumIntervalMs() - elapsed);
  if (waitMs > 0) await delay(waitMs);
  lastRequestStartedAt = Date.now();
}

function scheduleNcbiFetch(url, options = {}, retryOptions = {}) {
  const run = async () => {
    await waitForNcbiSlot();
    return fetchWithRetry(url, options, {
      retries: 3,
      timeoutMs: 18000,
      retryDelayMs: 900,
      ...retryOptions,
    });
  };

  const result = queueTail.then(run, run);
  queueTail = result.catch(() => undefined);
  return result;
}

module.exports = {
  scheduleNcbiFetch,
  minimumIntervalMs,
};
