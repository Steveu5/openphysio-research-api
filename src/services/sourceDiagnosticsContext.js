const { AsyncLocalStorage } = require("node:async_hooks");

const diagnosticsStorage = new AsyncLocalStorage();

async function runWithSourceDiagnostics(callback) {
  const diagnostics = new Map();

  const result = await diagnosticsStorage.run(diagnostics, callback);
  return {
    result,
    diagnostics: Array.from(diagnostics.values()),
  };
}

// Combines the outcomes of several requests to the same provider:
//   ok + timeout/error -> partial     timeout + timeout -> timeout
//   empty + timeout/error -> partial  error (+ timeout) -> error
function mergeStatus(currentStatus, nextStatus) {
  const statuses = new Set([currentStatus, nextStatus].filter(Boolean));
  const failed = statuses.has("error") || statuses.has("timeout") || statuses.has("partial");
  if ((statuses.has("ok") || statuses.has("empty")) && failed) return "partial";
  if (statuses.has("partial")) return "partial";
  if (statuses.has("ok")) return "ok";
  if (statuses.has("empty")) return "empty";
  if (statuses.has("error")) return "error";
  if (statuses.has("timeout")) return "timeout";
  return nextStatus || currentStatus || "unknown";
}

// Keeps provider errors short and free of stack traces or URLs.
function summarizeError(error) {
  if (!error) return null;
  return String(error).replace(/https?:\/\/\S+/g, "[url]").slice(0, 160);
}

function recordSourceDiagnostic(source, diagnostic = {}) {
  const diagnostics = diagnosticsStorage.getStore();
  if (!diagnostics) return;

  const current = diagnostics.get(source);
  if (!current) {
    diagnostics.set(source, {
      source,
      requests: 1,
      ...diagnostic,
      timed_out: Boolean(diagnostic.timed_out),
      error: summarizeError(diagnostic.error),
    });
    return;
  }

  const errors = [current.error, diagnostic.error].filter(Boolean);
  diagnostics.set(source, {
    ...current,
    ...diagnostic,
    source,
    label: diagnostic.label || current.label,
    status: mergeStatus(current.status, diagnostic.status),
    retrieved_count:
      Number(current.retrieved_count || 0) +
      Number(diagnostic.retrieved_count || 0),
    duration_ms: Math.max(
      Number(current.duration_ms || 0),
      Number(diagnostic.duration_ms || 0)
    ),
    requests: Number(current.requests || 1) + 1,
    timed_out: Boolean(current.timed_out || diagnostic.timed_out),
    error: errors.length ? summarizeError(Array.from(new Set(errors)).join("; ")) : null,
  });
}

// Diagnostics recorded so far in the current operation, or null outside one.
function currentSourceDiagnostics() {
  const diagnostics = diagnosticsStorage.getStore();
  return diagnostics ? Array.from(diagnostics.values()) : null;
}

function hasSourceDiagnosticsContext() {
  return Boolean(diagnosticsStorage.getStore());
}

module.exports = {
  runWithSourceDiagnostics,
  recordSourceDiagnostic,
  currentSourceDiagnostics,
  hasSourceDiagnosticsContext,
  mergeStatus,
};
