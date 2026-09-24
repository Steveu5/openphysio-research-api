const { randomUUID } = require("node:crypto");
const { getSupabaseAdmin } = require("./supabase");
const { USAGE_PLANS, USAGE_TOOLS } = require("../config/usagePlans");
const { onAiOperationSummary } = require("./aiUsage");

// Backend-owned usage quotas for Chat and Research. The database functions
// (reserve_usage_unit, commit_usage_unit, release_usage_unit,
// record_usage_cost; service_role only) are the single source of truth.
//
// Lifecycle of one operation:
//   reserve  -> atomically takes one unit, or reports exceeded /
//               in_progress (same idempotency key still running) /
//               duplicate (same key already completed: no second charge,
//               no second answer)
//   commit   -> the operation completed and its response was produced
//   release  -> the operation failed before completing: the unit returns
//
// Cancellation policy: aborting the request in the browser does not stop
// work already running on the server. If the server completes the
// operation, the unit is consumed (the AI cost was incurred); if it fails,
// the unit is returned. Re-sending creates a new operation, so repeated
// cancel/resend can never produce free answers.
//
// Time reference: paid allowances reset on the first day of each UTC
// calendar month; the client only displays what this module returns.
// Trial allowances use the fixed period key "trial": they never reset.

const TRIAL_PERIOD_KEY = "trial";
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_\-:.]{8,200}$/;

const EXCEEDED_CODES = Object.freeze({
  chat: "CHAT_QUOTA_EXCEEDED",
  research: "RESEARCH_QUOTA_EXCEEDED",
});

function currentMonthKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function nextMonthStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString();
}

function isTrialStatus(subscriptionStatus) {
  return String(subscriptionStatus || "").toLowerCase() === "trialing";
}

/** Which allowance and counter period applies to this subscriber now. */
function resolveUsagePeriod({ subscriptionStatus, currentPeriodEnd = null, now = new Date() } = {}) {
  if (isTrialStatus(subscriptionStatus)) {
    return {
      plan: "trial",
      key: TRIAL_PERIOD_KEY,
      type: "trial",
      timezone: "UTC",
      resetsAt: null,
      trialEndsAt: currentPeriodEnd || null,
      limits: USAGE_PLANS.trial,
    };
  }
  return {
    plan: "paid",
    key: currentMonthKey(now),
    type: "monthly",
    timezone: "UTC",
    resetsAt: nextMonthStart(now),
    trialEndsAt: null,
    limits: USAGE_PLANS.paid,
  };
}

/** Client-supplied idempotency key, or a fresh one (no dedupe) if absent/invalid. */
function resolveIdempotencyKey(req) {
  const raw = String(req?.get?.("Idempotency-Key") || req?.headers?.["idempotency-key"] || "").trim();
  return IDEMPOTENCY_KEY_PATTERN.test(raw) ? raw : `srv-${randomUUID()}`;
}

function toolUsage(used, limit) {
  const safeUsed = Math.max(0, Number(used || 0));
  return {
    used: safeUsed,
    limit,
    remaining: Math.max(0, limit - safeUsed),
  };
}

function publicPeriod(period) {
  return {
    key: period.key,
    type: period.type,
    timezone: period.timezone,
    resetsAt: period.resetsAt,
    trialEndsAt: period.trialEndsAt,
  };
}

async function readCounters(userId, periodKey) {
  const supabase = getSupabaseAdmin();
  const [chat, research] = await Promise.all(
    [
      ["chat_usage", "chat"],
      ["research_usage", "research"],
    ].map(async ([table]) => {
      const { data, error } = await supabase
        .from(table)
        .select("used_count")
        .eq("user_id", userId)
        .eq("month_key", periodKey)
        .maybeSingle();
      if (error) throw error;
      return Number(data?.used_count || 0);
    })
  );
  return { chat, research };
}

/** Current usage of both tools for this subscriber (read-only). */
async function getUsageSummary({ userId, subscriptionStatus, currentPeriodEnd }) {
  const period = resolveUsagePeriod({ subscriptionStatus, currentPeriodEnd });
  const counters = await readCounters(userId, period.key);
  return {
    plan: period.plan,
    period: publicPeriod(period),
    chat: toolUsage(counters.chat, period.limits.chat),
    research: toolUsage(counters.research, period.limits.research),
  };
}

function quotaError(status, code, message, details) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.expose = true;
  error.details = details;
  return error;
}

/**
 * Reserve one unit of `tool` for this operation. Throws a public error
 * when the allowance is exhausted or the same operation is a duplicate.
 */
async function reserveUsage({ userId, tool, subscriptionStatus, currentPeriodEnd, idempotencyKey }) {
  if (!USAGE_TOOLS.includes(tool)) throw new Error(`Unknown usage tool: ${tool}`);
  const period = resolveUsagePeriod({ subscriptionStatus, currentPeriodEnd });
  const limit = period.limits[tool];

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("reserve_usage_unit", {
    p_user_id: userId,
    p_tool: tool,
    p_period_key: period.key,
    p_limit: limit,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw error;

  const outcome = data?.outcome;
  const usage = { plan: period.plan, period: publicPeriod(period), tool, ...toolUsage(data?.used, limit) };

  if (outcome === "reserved") {
    return { reservation: { id: data.reservation_id, tool }, usage };
  }
  if (outcome === "exceeded") {
    throw quotaError(
      429,
      EXCEEDED_CODES[tool],
      tool === "chat" ? "Chat usage limit reached" : "Research usage limit reached",
      usage
    );
  }
  if (outcome === "in_progress") {
    throw quotaError(409, "REQUEST_IN_PROGRESS", "This request is already being processed", { tool });
  }
  if (outcome === "duplicate") {
    throw quotaError(409, "DUPLICATE_REQUEST", "This request was already completed", { tool });
  }
  throw new Error(`Unexpected usage reservation outcome: ${outcome}`);
}

async function commitUsage(reservation) {
  if (!reservation?.id) return false;
  try {
    const { data, error } = await getSupabaseAdmin().rpc("commit_usage_unit", {
      p_reservation_id: reservation.id,
    });
    if (error) throw error;
    return Boolean(data);
  } catch (error) {
    // The unit stays reserved, i.e. still counted: never a free answer.
    console.warn("Usage commit delayed:", error?.message || error);
    return false;
  }
}

async function releaseUsage(reservation) {
  if (!reservation?.id) return false;
  try {
    const { data, error } = await getSupabaseAdmin().rpc("release_usage_unit", {
      p_reservation_id: reservation.id,
    });
    if (error) throw error;
    return Boolean(data?.released);
  } catch (error) {
    console.warn("Usage release error:", error?.message || error);
    return false;
  }
}

// Persist the measured AI cost of each metered operation on its unit.
onAiOperationSummary(async (summary, meta) => {
  if (!meta?.reservationId) return;
  const { error } = await getSupabaseAdmin().rpc("record_usage_cost", {
    p_reservation_id: meta.reservationId,
    p_ai_calls: summary.calls,
    p_input_tokens: summary.input_tokens,
    p_cache_hit_tokens: summary.cache_hit_tokens,
    p_cache_miss_tokens: summary.cache_miss_tokens,
    p_output_tokens: summary.output_tokens,
    p_cost_usd: summary.cost_usd,
  });
  if (error) console.warn("Usage cost persistence delayed:", error.message);
});

module.exports = {
  TRIAL_PERIOD_KEY,
  EXCEEDED_CODES,
  currentMonthKey,
  nextMonthStart,
  resolveUsagePeriod,
  resolveIdempotencyKey,
  getUsageSummary,
  reserveUsage,
  commitUsage,
  releaseUsage,
};
