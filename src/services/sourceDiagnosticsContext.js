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

function recordSourceDiagnostic(source, diagnostic = {}) {
  const diagnostics = diagnosticsStorage.getStore();
  if (!diagnostics) return;

  diagnostics.set(source, {
    source,
    ...diagnostic,
  });
}

module.exports = {
  runWithSourceDiagnostics,
  recordSourceDiagnostic,
};
