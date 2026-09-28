// Comparison questions ("A vs B"): targeted retrieval of head-to-head
// studies, detection of which retrieved studies compare both options
// directly, and the explicit statement used when none do.

function quote(term = "") {
  const clean = String(term || "").replace(/["()[\]]/g, " ").replace(/\s+/g, " ").trim();
  return clean ? `"${clean}"` : "";
}

function group(main, terms = []) {
  const items = Array.from(new Set([main, ...(terms || [])].filter(Boolean)))
    .slice(0, 3)
    .map(quote)
    .filter(Boolean);
  return items.length ? `(${items.join(" OR ")})` : "";
}

function isComparisonIntent(intent = {}) {
  return intent.question_type === "comparison" && Boolean(intent.intervention) && Boolean(intent.comparator);
}

// Boolean query requiring both arms (and the condition when known), used as
// an additional PubMed / Europe PMC search for comparison questions.
function buildComparisonQuery(intent = {}) {
  if (!isComparisonIntent(intent)) return null;
  const parts = [
    group(intent.intervention, intent.intervention_terms),
    group(intent.comparator, intent.comparator_terms),
    intent.condition ? group(intent.condition, intent.condition_terms) : "",
  ].filter(Boolean);
  return parts.length >= 2 ? parts.join(" AND ") : null;
}

function assessComparison(articles = [], intent = {}, language = "es") {
  if (!isComparisonIntent(intent)) return { requested: false };
  const direct = (Array.isArray(articles) ? articles : []).filter(
    (article) => article.clinical_match?.direct_comparison
  );
  const isEnglish = language === "en";
  const a = intent.intervention;
  const b = intent.comparator;
  const statement = direct.length
    ? null
    : isEnglish
      ? `No sufficient direct comparisons between ${a} and ${b} were found. Any conclusion about which is better is an indirect inference from studies that evaluate each option separately.`
      : "No se encontraron comparaciones directas suficientes entre las opciones consultadas. Cualquier conclusión sobre cuál es mejor es una inferencia indirecta a partir de estudios que evalúan cada opción por separado.";

  return {
    requested: true,
    version: "1.0.0",
    intervention: a,
    comparator: b,
    direct: direct.length > 0,
    direct_count: direct.length,
    direct_titles: direct.slice(0, 5).map((article) => article.title),
    statement,
  };
}

module.exports = {
  isComparisonIntent,
  buildComparisonQuery,
  assessComparison,
};
