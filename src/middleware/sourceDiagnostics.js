const { AsyncLocalStorage } = require("node:async_hooks");

const diagnosticsStorage = new AsyncLocalStorage();
let originalFetch = null;

const SOURCE_ORDER = ["pubmed", "europe_pmc", "cochrane"];

function identifySource(urlValue) {
  let url;

  try {
    url = new URL(String(urlValue));
  } catch (_error) {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();

  if (hostname.includes("eutils.ncbi.nlm.nih.gov")) {
    return {
      id: "pubmed",
      label: "PubMed",
      countable: pathname.endsWith("/esearch.fcgi"),
    };
  }

  if (
    hostname.includes("ebi.ac.uk") &&
    pathname.includes("/europepmc/")
  ) {
    return {
      id: "europe_pmc",
      label: "Europe PMC",
      countable: true,
    };
  }

  if (hostname.includes("api.crossref.org")) {
    return {
      id: "cochrane",
      label: "Cochrane",
      countable: true,
    };
  }

  return null;
}

async function extractRetrievedCount(source, response) {
  if (!source?.countable || !response?.ok) return null;

  try {
    const cloned = response.clone();

    if (source.id === "pubmed") {
      const data = await cloned.json();
      return Array.isArray(data?.esearchresult?.idlist)
        ? data.esearchresult.idlist.length
        : 0;
    }

    if (source.id === "europe_pmc") {
      const data = await cloned.json();
      return Array.isArray(data?.resultList?.result)
        ? data.resultList.result.length
        : 0;
    }

    if (source.id === "cochrane") {
      const data = await cloned.json();
      return Array.isArray(data?.message?.items)
        ? data.message.items.length
        : 0;
    }
  } catch (_error) {
    return null;
  }

  return null;
}

function recordAttempt({
  source,
  ok,
  retrievedCount = null,
  durationMs = 0,
  httpStatus = null,
}) {
  const store = diagnosticsStorage.getStore();
  if (!store || !source) return;

  const current = store.sources.get(source.id) || {
    source: source.id,
    label: source.label,
    requests: 0,
    successful_requests: 0,
    failed_requests: 0,
    retrieved_count: 0,
    duration_ms: 0,
    last_http_status: null,
  };

  current.requests += 1;
  current.duration_ms += Math.max(0, Number(durationMs) || 0);
  current.last_http_status = httpStatus;

  if (ok) {
    current.successful_requests += 1;

    if (Number.isInteger(retrievedCount) && retrievedCount >= 0) {
      current.retrieved_count += retrievedCount;
    }
  } else {
    current.failed_requests += 1;
  }

  store.sources.set(source.id, current);
}

function toPublicDiagnostic(item) {
  let status = "empty";
  let message = "La fuente respondió, pero no encontró registros compatibles.";

  if (item.successful_requests === 0 && item.failed_requests > 0) {
    status = "error";
    message = "No se pudo consultar esta fuente temporalmente.";
  } else if (item.successful_requests > 0 && item.failed_requests > 0) {
    status = "partial";
    message = item.retrieved_count > 0
      ? "La fuente respondió después de uno o más intentos fallidos."
      : "La consulta fue parcial y no recuperó registros compatibles.";
  } else if (item.retrieved_count > 0) {
    status = "success";
    message = "Fuente consultada correctamente.";
  }

  return {
    source: item.source,
    label: item.label,
    status,
    retrieved_count: item.retrieved_count,
    requests: item.requests,
    failed_requests: item.failed_requests,
    duration_ms: item.duration_ms,
    message,
  };
}

function getCurrentSourceDiagnostics() {
  const store = diagnosticsStorage.getStore();
  if (!store) return [];

  return Array.from(store.sources.values())
    .map(toPublicDiagnostic)
    .sort(
      (left, right) =>
        SOURCE_ORDER.indexOf(left.source) -
        SOURCE_ORDER.indexOf(right.source)
    );
}

function attachSourceDiagnostics(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload.sourceDiagnostics)) {
    return payload;
  }

  const sourceDiagnostics = getCurrentSourceDiagnostics();
  if (sourceDiagnostics.length === 0) return payload;

  payload.sourceDiagnostics = sourceDiagnostics;
  return payload;
}

function installTrackedFetch() {
  if (originalFetch || typeof global.fetch !== "function") return;

  originalFetch = global.fetch.bind(global);

  global.fetch = async (...args) => {
    const urlValue =
      typeof args[0] === "string" || args[0] instanceof URL
        ? args[0]
        : args[0]?.url;

    const source = identifySource(urlValue);
    const startedAt = Date.now();

    try {
      const response = await originalFetch(...args);
      const retrievedCount = await extractRetrievedCount(source, response);

      recordAttempt({
        source,
        ok: response.ok,
        retrievedCount,
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
      });

      return response;
    } catch (error) {
      recordAttempt({
        source,
        ok: false,
        durationMs: Date.now() - startedAt,
        httpStatus: null,
      });

      throw error;
    }
  };
}

function sourceDiagnosticsMiddleware(req, res, next) {
  installTrackedFetch();

  if (!req.originalUrl?.startsWith("/research/search")) {
    return next();
  }

  return diagnosticsStorage.run(
    {
      sources: new Map(),
    },
    () => {
      const originalJson = res.json.bind(res);

      res.json = (payload) => originalJson(
        attachSourceDiagnostics(payload)
      );

      next();
    }
  );
}

module.exports = {
  sourceDiagnosticsMiddleware,
  getCurrentSourceDiagnostics,
  attachSourceDiagnostics,
  identifySource,
  toPublicDiagnostic,
};
