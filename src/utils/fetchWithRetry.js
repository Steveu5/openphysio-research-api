function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRetryableStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(Number(status));
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

    try {
      const response = await fetch(url, {
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

      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;

      if (attempt >= retries) {
        throw error;
      }
    }

    await delay(retryDelayMs * 2 ** attempt);
  }

  throw lastError || new Error("Request failed after retries");
}

module.exports = {
  fetchWithRetry,
  isRetryableStatus,
};
