// Per-operation time budget for each external evidence provider (P2.1).
//
// Every search operation (one searchEvidence call) gets one total budget per
// provider, shared by all of that provider's requests in the operation:
// Europe PMC's main search, its comparison search and the Crossref
// enrichment all draw on the same Europe PMC deadline. Once a provider's
// deadline passes, its in-flight requests are aborted and later requests are
// skipped, so a slow provider can add at most its budget to a search.
// Outside an operation (e.g. a one-off lookup) each call gets its own budget.

const { AsyncLocalStorage } = require("node:async_hooks");

// Chosen from the measured baseline (2026-09-29, 8 real searches):
//   PubMed calls 2.6-7.3 s each (serialized by the NCBI queue; JOSPT runs 2
//   sequentially, up to 8.2 s); Crossref 0.9-1.4 s; healthy Europe PMC
//   responses 2-6 s, stalled ones 19-46 s.
const DEFAULT_BUDGETS_MS = {
  pubmed: 20_000,
  europe_pmc: 10_000,
  crossref: 8_000,
};

const storage = new AsyncLocalStorage();

function configuredBudgetMs(provider) {
  const fromEnv = Number(process.env[`PROVIDER_BUDGET_MS_${String(provider).toUpperCase()}`]);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return DEFAULT_BUDGETS_MS[provider] || 10_000;
}

function createBudget(provider, startedAt, budgetMs) {
  return {
    provider,
    budgetMs,
    deadline: startedAt + budgetMs,
    remaining(now = Date.now()) {
      return Math.max(0, this.deadline - now);
    },
  };
}

function runWithProviderBudgets(callback, { startedAt = Date.now(), budgets = {} } = {}) {
  return storage.run({ startedAt, overrides: budgets, budgets: new Map() }, callback);
}

function getProviderBudget(provider) {
  const store = storage.getStore();
  if (!store) return createBudget(provider, Date.now(), configuredBudgetMs(provider));
  if (!store.budgets.has(provider)) {
    const budgetMs = store.overrides[provider] || configuredBudgetMs(provider);
    store.budgets.set(provider, createBudget(provider, store.startedAt, budgetMs));
  }
  return store.budgets.get(provider);
}

module.exports = {
  DEFAULT_BUDGETS_MS,
  configuredBudgetMs,
  runWithProviderBudgets,
  getProviderBudget,
};
