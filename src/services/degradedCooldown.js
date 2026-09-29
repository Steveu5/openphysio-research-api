// Abuse guard for degraded answers, which never consume a unit.
//
// A degraded answer (the model could not produce a valid clinical answer)
// is free for the user. To stop an operation that keeps degrading (or is
// made to) from being repeated without limit, each user gets a short
// cooldown per tool after DEGRADED_BURST degraded answers within
// DEGRADED_WINDOW_MS: new operations of that tool are refused with 429 for
// DEGRADED_COOLDOWN_MS. Nothing is ever charged. In memory and bounded, like
// the rate limiter; it resets on restart.

const DEGRADED_BURST = 3;
const DEGRADED_WINDOW_MS = 10 * 60_000;
const DEGRADED_COOLDOWN_MS = 10 * 60_000;
const MAX_KEYS = 10_000;

const events = new Map(); // key -> { times: number[], cooldownUntil: number }

function keyOf(userId, tool) {
  return `${tool}:${userId}`;
}

function recordDegraded(userId, tool, now = Date.now()) {
  if (!userId) return;
  const key = keyOf(userId, tool);
  const entry = events.get(key) || { times: [], cooldownUntil: 0 };
  entry.times = entry.times.filter((t) => now - t < DEGRADED_WINDOW_MS);
  entry.times.push(now);
  if (entry.times.length >= DEGRADED_BURST) {
    entry.cooldownUntil = now + DEGRADED_COOLDOWN_MS;
    entry.times = [];
  }
  events.delete(key);
  events.set(key, entry);
  if (events.size > MAX_KEYS) events.delete(events.keys().next().value);
}

function cooldownRemainingSeconds(userId, tool, now = Date.now()) {
  const entry = events.get(keyOf(userId, tool));
  if (!entry || entry.cooldownUntil <= now) return 0;
  return Math.ceil((entry.cooldownUntil - now) / 1000);
}

function assertNotCoolingDown(userId, tool, now = Date.now()) {
  const seconds = cooldownRemainingSeconds(userId, tool, now);
  if (!seconds) return;
  const error = new Error(
    "Several recent answers could not be generated. Please try again in a few minutes."
  );
  error.status = 429;
  error.code = "DEGRADED_COOLDOWN";
  error.expose = true;
  error.retryAfterSeconds = seconds;
  error.details = { tool, retry_after_seconds: seconds };
  throw error;
}

function resetDegradedCooldowns() {
  events.clear();
}

module.exports = {
  DEGRADED_BURST,
  DEGRADED_WINDOW_MS,
  DEGRADED_COOLDOWN_MS,
  recordDegraded,
  cooldownRemainingSeconds,
  assertNotCoolingDown,
  resetDegradedCooldowns,
};
