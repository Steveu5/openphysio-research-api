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

function mergeStatus(currentStatus, nextStatus) {
  const statuses = new Set([currentStatus, nextStatus].filter(Boolean));
  if (statuses.has("ok") && statuses.has("error")) return "partial";
  if (statuses.has("ok")) return "ok";
  if (statuses.has("empty") && statuses.has("error")) return "partial";
  if (statuses.has("empty")) return "empty";
  if (statuses.has("error")) return "error";
  return nextStatus || currentStatus || "unknown";
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
    error: errors.length ? Array.from(new Set(errors)).join("; ") : null,
  });
}

module.exports = {
  runWithSourceDiagnostics,
  recordSourceDiagnostic,
};
