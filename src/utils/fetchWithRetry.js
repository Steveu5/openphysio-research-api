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

// --- P2.1: budgeted provider requests -------------------------------------
//
// fetchWithBudget draws on the provider's total budget for the current
// search operation (providerBudget). Differences with fetchWithRetry:
//   - each attempt is aborted at min(timeoutMs, remaining budget), and the
//     abort covers the response body too (parsed before the timer clears);
//   - a timeout is never retried;
//   - fast retryable responses (429/5xx) and network errors are retried only
//     while the remaining budget can still fit the wait plus an attempt, and
//     Retry-After is honoured only within that budget;
//   - when the budget is spent the request is skipped immediately.
// NCBI throttling (queuedFetch) is unchanged.

const MIN_ATTEMPT_MS = 500;

function abortable(promise, signal) {
  if (signal.aborted) {
    promise.catch(() => {});
    return Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      promise.then((late) => late?.body?.cancel?.().catch(() => {}), () => {});
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => { signal.removeEventListener("abort", onAbort); reject(error); }
    );
  });
}

class ProviderRequestError extends Error {
  constructor(message, { provider, code, status = null, timedOut = false, budgetMs = null } = {}) {
    super(message);
    this.name = "ProviderRequestError";
    this.provider = provider;
    this.code = code;
    this.status = status;
    this.timedOut = timedOut;
    this.budgetMs = budgetMs;
  }
}

async function fetchWithBudget(
  url,
  options = {},
  { provider, retries = 1, timeoutMs = 10000, retryDelayMs = 400, parse = "json" } = {}
) {
  // Required lazily to keep this utility free of service dependencies.
  const { getProviderBudget } = require("../services/providerBudget");
  const budget = getProviderBudget(provider);
  // Smallest attempt worth starting (scaled down for very small budgets).
  const minAttemptMs = Math.min(MIN_ATTEMPT_MS, budget.budgetMs / 4);
  let attempt = 0;

  for (;;) {
    const remaining = budget.remaining();
    if (remaining < minAttemptMs) {
      throw new ProviderRequestError(`${provider} budget exhausted`, {
        provider,
        code: "PROVIDER_BUDGET_EXHAUSTED",
        timedOut: true,
        budgetMs: budget.budgetMs,
      });
    }

    const attemptMs = Math.min(timeoutMs, remaining);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, attemptMs);

    let response;
    try {
      // The abort also ends the wait for a queue slot (NCBI throttling): a
      // request still queued when its time runs out settles immediately, and
      // when its turn comes fetch receives an aborted signal and never hits
      // the network.
      response = await abortable(
        queuedFetch(url, { ...options, signal: controller.signal }),
        controller.signal
      );
      if (response.ok) {
        const data = parse === "text" ? await response.text() : await response.json();
        return { ok: true, status: response.status, data };
      }
    } catch (error) {
      if (timedOut || error?.name === "AbortError" || error?.name === "TimeoutError") {
        throw new ProviderRequestError(`${provider} timed out after ${attemptMs} ms`, {
          provider,
          code: "PROVIDER_TIMEOUT",
          timedOut: true,
          budgetMs: budget.budgetMs,
        });
      }
      const wait = retryDelayMs * 2 ** attempt;
      if (attempt < retries && wait + minAttemptMs < budget.remaining()) {
        attempt += 1;
        await delay(wait);
        continue;
      }
      throw new ProviderRequestError(`${provider} request failed`, {
        provider,
        code: "PROVIDER_NETWORK_ERROR",
        budgetMs: budget.budgetMs,
      });
    } finally {
      clearTimeout(timer);
    }

    // Non-OK response.
    const status = response.status;
    const retryAfterMs = getRetryAfterMs(response);
    await response.body?.cancel?.().catch(() => {});
    const wait = Math.max(retryAfterMs, retryDelayMs * 2 ** attempt);
    if (isRetryableStatus(status) && attempt < retries && wait + minAttemptMs < budget.remaining()) {
      attempt += 1;
      await delay(wait);
      continue;
    }
    throw new ProviderRequestError(`${provider} HTTP ${status}`, {
      provider,
      code: "PROVIDER_HTTP_ERROR",
      status,
      budgetMs: budget.budgetMs,
    });
  }
}

module.exports = {
  fetchWithBudget,
  ProviderRequestError,
  MIN_ATTEMPT_MS,
  fetchWithRetry,
  isRetryableStatus,
  isNcbiUrl,
  ncbiMinimumIntervalMs,
};
