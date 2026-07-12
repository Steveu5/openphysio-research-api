function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRetryableStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(Number(status));
}

const hostQueues = new Map();
const hostLastStartedAt = new Map();

function isNcbiUrl(url) {
  try {
    return new URL(url).hostname === "eutils.ncbi.nlm.nih.gov";
  } catch {
    return false;
  }
}

function ncbiMinimumIntervalMs() {
  return process.env.NCBI_API_KEY ? 120 : 380;
}

function queuedFetch(url, options = {}) {
  if (!isNcbiUrl(url)) return fetch(url, options);

  const host = "eutils.ncbi.nlm.nih.gov";
  const previous = hostQueues.get(host) || Promise.resolve();
  const run = async () => {
    const elapsed = Date.now() - Number(hostLastStartedAt.get(host) || 0);
    const waitMs = Math.max(0, ncbiMinimumIntervalMs() - elapsed);
    if (waitMs > 0) await delay(waitMs);
    hostLastStartedAt.set(host, Date.now());
    return fetch(url, options);
  };

  const result = previous.then(run, run);
  hostQueues.set(host, result.catch(() => undefined));
  return result;
}

function getRetryAfterMs(response) {
  const value = response?.headers?.get?.("retry-after");
  if (!value) return 0;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const retryDate = Date.parse(value);
  return Number.isFinite(retryDate) ? Math.max(0, retryDate - Date.now()) : 0;
}

async function fetchWithRetry(
  url,
  options = {},
  {
    retries = 2,
    timeoutMs = 15000,
    retryDelayMs = 400,
  } = {}
) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let retryAfterMs = 0;

    try {
      const response = await queuedFetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (
        response.ok ||
        attempt >= retries ||
        isRetryableStatus(response.status) === false
      ) {
        return response;
      }

      retryAfterMs = getRetryAfterMs(response);
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;

      if (attempt >= retries) {
        throw error;
      }
    }

    await delay(
      Math.max(retryAfterMs, retryDelayMs * 2 ** attempt)
    );
  }

  throw lastError || new Error("Request failed after retries");
}

module.exports = {
  fetchWithRetry,
  isRetryableStatus,
  isNcbiUrl,
  ncbiMinimumIntervalMs,
};
