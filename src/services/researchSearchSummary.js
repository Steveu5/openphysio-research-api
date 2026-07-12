function normalize(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function retrievalSource(article = {}) {
  return normalize(article.retrieval_source_name || article.source_name);
}

function isPrimarySource(article = {}, source = "") {
  const retrieval = retrievalSource(article);
  if (source === "pubmed") return retrieval.includes("pubmed");
  if (source === "europe_pmc") return retrieval.includes("europe pmc");
  if (source === "openalex") return retrieval.includes("openalex");
  if (source === "crossref") return retrieval.includes("crossref");
  return false;
}

function countEvidenceTypes(articles = []) {
  const counts = {
    guidelines: 0,
    systematic_reviews: 0,
    trials: 0,
    protocols: 0,
  };

  for (const article of articles) {
    const text = normalize(
      `${article.evidence_level || ""} ${article.evidence_level_label_es || ""} ${article.study_type || ""}`
    );

    if (
      article.library_resource ||
      text.includes("guideline") ||
      text.includes("guia") ||
      text.includes("guía")
    ) {
      counts.guidelines += 1;
      continue;
    }

    if (text.includes("protocol") || text.includes("protocolo")) {
      counts.protocols += 1;
      continue;
    }

    if (
      text.includes("systematic") ||
      text.includes("meta analysis") ||
      text.includes("revision sistematica") ||
      text.includes("revisión sistemática")
    ) {
      counts.systematic_reviews += 1;
      continue;
    }

    if (
      text.includes("randomized") ||
      text.includes("randomised") ||
      text.includes("ensayo clinico") ||
      text.includes("ensayo clínico")
    ) {
      counts.trials += 1;
    }
  }

  return counts;
}

function normalizeJournalName(value = "") {
  const raw = String(value || "").trim();
  const lower = raw.toLowerCase();

  if (lower === "plos one" || lower === "plos one.") return "PLOS ONE";
  if (lower.includes("journal of physiotherapy")) return "Journal of Physiotherapy";
  if (lower.includes("orthopaedic") && lower.includes("sports physical therapy")) {
    return "JOSPT";
  }
  if (lower.includes("british journal of sports medicine")) return "BJSM";
  if (lower.includes("cochrane database of systematic reviews")) {
    return "Cochrane Database of Systematic Reviews";
  }

  return raw;
}

function buildSourceDiagnostics(
  evidence = {},
  liveDiagnostics = [],
  displayedArticles = []
) {
  const articles = Array.isArray(displayedArticles) ? displayedArticles : [];
  const liveBySource = new Map(
    (Array.isArray(liveDiagnostics) ? liveDiagnostics : []).map((item) => [
      item.source,
      item,
    ])
  );

  const definitions = [
    { source: "pubmed", label: "PubMed" },
    { source: "europe_pmc", label: "Europe PMC" },
    { source: "openalex", label: "OpenAlex" },
    { source: "crossref", label: "Crossref" },
  ];

  return definitions.map((definition) => {
    const live = liveBySource.get(definition.source);
    const visiblePrimaryCount = articles.filter((article) =>
      isPrimarySource(article, definition.source)
    ).length;
    const visibleIndexedCount =
      definition.source === "pubmed"
        ? articles.filter((article) => Boolean(article.pmid)).length
        : null;

    let status = live?.status || "unknown";
    if (!live && visiblePrimaryCount > 0) status = "searched";
    if (!live && visiblePrimaryCount === 0) status = "searched_no_selected_results";

    return {
      ...definition,
      status,
      retrieved_count:
        live?.retrieved_count == null ? null : Number(live.retrieved_count),
      visible_primary_count: visiblePrimaryCount,
      visible_indexed_count: visibleIndexedCount,
      selected_count: visiblePrimaryCount,
      duration_ms:
        live?.duration_ms == null ? null : Number(live.duration_ms),
      requests: live?.requests == null ? 0 : Number(live.requests),
      error:
        status === "error" || status === "partial"
          ? live?.error || null
          : null,
    };
  });
}

function buildSearchSummary({
  sourceDiagnostics = [],
  displayedArticles = [],
  selectionDiagnostics = {},
  qualityDiagnostics = {},
} = {}) {
  const articles = Array.isArray(displayedArticles) ? displayedArticles : [];
  const rawRetrieved = sourceDiagnostics.reduce(
    (total, item) => total + Math.max(0, Number(item.retrieved_count || 0)),
    0
  );
  const databases = sourceDiagnostics
    .filter(
      (item) =>
        Number(item.requests || 0) > 0 ||
        ["ok", "empty", "partial", "error", "searched"].includes(item.status)
    )
    .map((item) => item.label);
  const journals = Array.from(
    new Set(
      articles
        .map((article) => normalizeJournalName(article.journal))
        .filter(Boolean)
    )
  );

  return {
    version: "1.0.0",
    raw_records_retrieved: rawRetrieved,
    raw_records_note:
      "Suma de registros devueltos por las búsquedas; puede incluir el mismo artículo en más de una base de datos o consulta.",
    unique_candidates_after_deduplication: Number(
      selectionDiagnostics.condition_filtered_count ||
        selectionDiagnostics.original_count ||
        articles.length
    ),
    displayed_unique_articles: articles.length,
    databases_consulted_count: databases.length,
    databases_consulted: databases,
    journals_represented_count: journals.length,
    journals_represented: journals,
    evidence_types: countEvidenceTypes(articles),
    direct_articles: Number(qualityDiagnostics.direct_count || 0),
    indirect_articles: Number(qualityDiagnostics.indirect_count || 0),
    excluded: {
      population_mismatch: Number(
        qualityDiagnostics.population_mismatch_removed || 0
      ),
      stage_mismatch: Number(qualityDiagnostics.stage_mismatch_removed || 0),
      highly_indirect: Number(qualityDiagnostics.highly_indirect_removed || 0),
      protocols: Number(qualityDiagnostics.protocols_removed || 0),
      previous_review_versions: Number(
        qualityDiagnostics.review_versions_collapsed || 0
      ),
    },
  };
}

module.exports = {
  normalizeJournalName,
  countEvidenceTypes,
  buildSourceDiagnostics,
  buildSearchSummary,
};
