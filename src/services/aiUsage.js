const { AsyncLocalStorage } = require("node:async_hooks");
const { randomUUID } = require("node:crypto");

// AI cost metering. Every DeepSeek call records one `ai_call` log line;
// every metered operation (one Chat question, one Research search) records
// one `ai_operation` line with the sum of all its internal calls, including
// background calls that finish after the HTTP response. Metering must never
// break or delay a clinical response: every entry point swallows its own
// errors, and nothing here logs keys, user identifiers or clinical text.

// Official DeepSeek pricing, USD per 1M tokens
// (https://api-docs.deepseek.com/quick_start/pricing, checked 2026-09-23).
// Off-peak rates are half of peak. Legacy Flash names are billed as Flash.
const PRICING_SOURCE = "api-docs.deepseek.com/quick_start/pricing@2026-09-23";
const FLASH_PRICING = Object.freeze({
  peak: { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 },
  offPeak: { cacheHit: 0.003, cacheMiss: 0.15, output: 0.6 },
});
const MODEL_PRICING = Object.freeze({
  "deepseek-flash": FLASH_PRICING,
  "deepseek-v4-flash": FLASH_PRICING,
  "deepseek-v4-flash-vision-exp": FLASH_PRICING,
  "deepseek-v4-pro": {
    peak: { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 },
    offPeak: { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 },
  },
});

// Peak: 01:00-04:00 and 06:00-10:00 UTC, Monday-Friday. Chinese public
// holidays are off-peak; they are not modelled, so those days may be
// slightly overestimated.
function isPeakTime(date = new Date()) {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = date.getUTCHours();
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

function priceFor(model, date) {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;
  return isPeakTime(date) ? pricing.peak : pricing.offPeak;
}

function toCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

/** Normalize a DeepSeek `usage` object into billable token counts. */
function normalizeUsage(usage = {}) {
  const inputTokens = toCount(usage.prompt_tokens);
  const cacheHitTokens = toCount(usage.prompt_cache_hit_tokens);
  const cacheMissTokens =
    usage.prompt_cache_miss_tokens != null
      ? toCount(usage.prompt_cache_miss_tokens)
      : Math.max(inputTokens - cacheHitTokens, 0);
  return {
    inputTokens,
    cacheHitTokens,
    cacheMissTokens,
    outputTokens: toCount(usage.completion_tokens),
    reasoningTokens: toCount(usage.completion_tokens_details?.reasoning_tokens),
  };
}

/** Estimated USD cost of one call, or null if the model has no known price. */
function estimateCostUsd(model, tokens, date = new Date()) {
  const price = priceFor(model, date);
  if (!price) return null;
  const cost =
    (tokens.cacheHitTokens * price.cacheHit +
      tokens.cacheMissTokens * price.cacheMiss +
      tokens.outputTokens * price.output) /
    1_000_000;
  return Number(cost.toFixed(8));
}

const storage = new AsyncLocalStorage();

function safeLog(entry) {
  try {
    console.log(JSON.stringify(entry));
  } catch {
    // Metering must never interfere with the response.
  }
}

function emptyTotals() {
  return {
    calls: 0,
    failed_calls: 0,
    input_tokens: 0,
    cache_hit_tokens: 0,
    cache_miss_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cost_usd: 0,
    ai_latency_ms: 0,
  };
}

/**
 * Begin tracking one DeepSeek call. Returns a function to call exactly once
 * with the outcome. Never throws.
 */
function startAiCall({ purpose, requestedModel }) {
  const startedAt = Date.now();
  let scope = null;
  let settle = () => {};
  try {
    scope = storage.getStore() || null;
    if (scope) {
      scope.pending.add(
        new Promise((resolve) => {
          settle = resolve;
        })
      );
    }
  } catch {
    scope = null;
  }

  let finished = false;
  return function finishAiCall({ ok, returnedModel = null, usage = null, errorCode = null }) {
    if (finished) return;
    finished = true;
    try {
      const date = new Date();
      const tokens = normalizeUsage(usage || {});
      const costUsd = usage ? estimateCostUsd(requestedModel, tokens, date) : 0;
      const entry = {
        type: "ai_call",
        operation: scope?.operation || "unscoped",
        operation_id: scope?.id || null,
        purpose: purpose || "unspecified",
        requested_model: requestedModel,
        returned_model: returnedModel,
        ok: Boolean(ok),
        error_code: errorCode,
        input_tokens: tokens.inputTokens,
        cache_hit_tokens: tokens.cacheHitTokens,
        cache_miss_tokens: tokens.cacheMissTokens,
        output_tokens: tokens.outputTokens,
        reasoning_tokens: tokens.reasoningTokens,
        cost_usd: costUsd,
        price_known: costUsd !== null,
        pricing_period: isPeakTime(date) ? "peak" : "off_peak",
        latency_ms: date.getTime() - startedAt,
        after_response: Boolean(scope?.summarized),
        at: date.toISOString(),
      };
      safeLog(entry);

      if (scope) {
        const totals = scope.totals;
        totals.calls += 1;
        if (!entry.ok) totals.failed_calls += 1;
        totals.input_tokens += entry.input_tokens;
        totals.cache_hit_tokens += entry.cache_hit_tokens;
        totals.cache_miss_tokens += entry.cache_miss_tokens;
        totals.output_tokens += entry.output_tokens;
        totals.reasoning_tokens += entry.reasoning_tokens;
        totals.cost_usd += entry.cost_usd || 0;
        totals.ai_latency_ms += entry.latency_ms;
        scope.purposes[entry.purpose] = (scope.purposes[entry.purpose] || 0) + 1;
        scope.models.add(`${requestedModel}->${returnedModel || "?"}`);
      }
    } catch {
      // ignore
    } finally {
      settle();
    }
  };
}

const MAX_BACKGROUND_WAIT_MS = 120_000;

async function waitForPending(scope) {
  const deadline = Date.now() + MAX_BACKGROUND_WAIT_MS;
  while (scope.pending.size && Date.now() < deadline) {
    const batch = [...scope.pending];
    let timer;
    await Promise.race([
      Promise.allSettled(batch),
      new Promise((resolve) => {
        timer = setTimeout(resolve, Math.max(deadline - Date.now(), 0));
        timer.unref?.();
      }),
    ]);
    clearTimeout(timer);
    batch.forEach((promise) => scope.pending.delete(promise));
    // Let calls started by just-settled work register before re-checking.
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const summaryListeners = new Set();

/** Register a listener for completed operation summaries. Errors are swallowed. */
function onAiOperationSummary(listener) {
  summaryListeners.add(listener);
  return () => summaryListeners.delete(listener);
}

function notifySummaryListeners(summary, meta) {
  for (const listener of summaryListeners) {
    try {
      Promise.resolve(listener(summary, meta)).catch(() => {});
    } catch {
      // ignore
    }
  }
}

async function summarize(scope, res) {
  try {
    await waitForPending(scope);
    const totals = scope.totals;
    const summary = {
      type: "ai_operation",
      operation: scope.operation,
      operation_id: scope.id,
      http_status: res.statusCode,
      completed: res.statusCode < 400,
      cached_result: scope.meta.cached ?? null,
      conversational_shortcut: scope.meta.conversational ?? null,
      counts_as_chat_quota_unit: scope.operation === "chat_question" && res.statusCode < 400,
      ...totals,
      cost_usd: Number(totals.cost_usd.toFixed(8)),
      calls_by_purpose: scope.purposes,
      models: [...scope.models],
      pending_calls_unfinished: scope.pending.size,
      total_duration_ms: Date.now() - scope.startedAt,
      pricing_source: PRICING_SOURCE,
      at: new Date().toISOString(),
    };
    safeLog(summary);
    notifySummaryListeners(summary, { ...scope.meta });
  } catch {
    // ignore
  } finally {
    scope.summarized = true;
  }
}

/** Express middleware: meter every AI call made while handling this request. */
function meterAiOperation(operation) {
  return function aiOperationMeter(req, res, next) {
    let scope;
    try {
      scope = {
        id: randomUUID(),
        operation,
        startedAt: Date.now(),
        totals: emptyTotals(),
        purposes: {},
        models: new Set(),
        pending: new Set(),
        meta: {},
        summarized: false,
      };
      let done = false;
      const onDone = () => {
        if (done) return;
        done = true;
        summarize(scope, res);
      };
      res.once("finish", onDone);
      res.once("close", onDone);
    } catch {
      return next();
    }
    return storage.run(scope, () => next());
  };
}

/** Attach non-identifying context (e.g. cached result) to the current operation. */
function annotateAiOperation(meta = {}) {
  try {
    const scope = storage.getStore();
    if (scope) Object.assign(scope.meta, meta);
  } catch {
    // ignore
  }
}

module.exports = {
  PRICING_SOURCE,
  MODEL_PRICING,
  isPeakTime,
  normalizeUsage,
  estimateCostUsd,
  startAiCall,
  meterAiOperation,
  annotateAiOperation,
  onAiOperationSummary,
};
