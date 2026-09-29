// Outcome of the evidence retrieval for one search operation (P2.1).
//
// Separates two situations that look alike to the user:
//   - evidence insufficient: the providers answered; there is simply no
//     usable evidence for the question;
//   - retrieval degraded: providers that matter failed or timed out, so an
//     empty result cannot be read as "no evidence exists".
// OpenAlex is deliberately disabled and not an active provider. JOSPT and
// the preferred-guideline searches go through PubMed.

const ACTIVE_PROVIDERS = ["pubmed", "europe_pmc", "crossref"];
const FAILED = new Set(["timeout", "error"]);
const ANSWERED = new Set(["ok", "empty", "partial"]);

function summarizeRetrieval(diagnostics = []) {
  const bySource = new Map((Array.isArray(diagnostics) ? diagnostics : []).map((d) => [d.source, d]));
  const providers = ACTIVE_PROVIDERS.map((source) => {
    const d = bySource.get(source);
    return {
      source,
      status: d?.status || "not_called",
      requests: d?.requests || 0,
      retrieved_count: d?.retrieved_count ?? 0,
      duration_ms: d?.duration_ms ?? null,
      timed_out: Boolean(d?.timed_out),
      budget_ms: d?.budget_ms ?? null,
      error: FAILED.has(d?.status) || d?.status === "partial" ? d?.error || null : null,
    };
  });
  const failed = providers.filter((p) => FAILED.has(p.status));
  const answered = providers.filter((p) => ANSWERED.has(p.status));
  const incomplete = providers.filter((p) => FAILED.has(p.status) || p.status === "partial");
  const pubmedFailed = FAILED.has(providers.find((p) => p.source === "pubmed").status);

  const status = !incomplete.length ? "complete" : answered.length ? "partial" : "failed";
  return {
    version: "1.0.0",
    status,
    // PubMed is the primary index; losing it, or two providers, or all of
    // them, means an empty result may be technical rather than scientific.
    important_failure: pubmedFailed || failed.length >= 2 || !answered.length,
    failed_providers: failed.map((p) => p.source),
    providers,
  };
}

// Only a fully completed retrieval may become the shared canonical cache.
function isCacheableRetrieval(retrieval) {
  return !retrieval || retrieval.status === "complete" || retrieval.status === "cached";
}

module.exports = {
  ACTIVE_PROVIDERS,
  summarizeRetrieval,
  isCacheableRetrieval,
};
