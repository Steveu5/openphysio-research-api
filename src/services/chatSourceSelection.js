// Final selection of the sources Chat answers from and cites.
//
// Works on the P0 clinical ranking without reordering it: it walks the
// ranked list and keeps only sources that apply to the question, stopping
// as soon as the core of the answer is covered. Limits avoid both a single
// weak source and long lists of marginal ones.

const { isUsableEvidence } = require("./evidenceSufficiency");
const { isComparisonIntent } = require("./comparisonEvidence");

const MIN_SOURCES = 2;
const MAX_SOURCES = 5;
const MAX_COMPARISON_SOURCES = 6;
// Without any direct source the evidence is limited: a few are enough.
const MAX_WITHOUT_DIRECT = 3;
// Shown when nothing applies (insufficient-evidence answer).
const MAX_CLOSEST_WHEN_NONE_APPLIES = 3;

function tierOf(article = {}) {
  return article.clinical_match?.tier || null;
}

function isSynthesisOrGuideline(article = {}) {
  const text = `${article.evidence_level || ""} ${article.study_type || ""}`.toLowerCase();
  return /systematic|meta.?analys|guideline|cochrane/.test(text) || Boolean(article.library_resource);
}

// The answer's core is covered when:
//   - comparison: head-to-head evidence plus context, i.e. at least three
//     direct sources of which two compare the options directly, or four
//     direct sources with at least one head-to-head study;
//   - otherwise: two direct guidelines/reviews (e.g. a good guideline and a
//     systematic review), or one plus two other direct sources, or four
//     direct sources.
function coreCovered(selected = [], comparison = false) {
  const direct = selected.filter((article) => tierOf(article) === "direct");
  const syntheses = direct.filter(isSynthesisOrGuideline);
  if (comparison) {
    const headToHead = direct.filter((article) => article.clinical_match?.direct_comparison);
    return (headToHead.length >= 2 && direct.length >= 3) || (headToHead.length >= 1 && direct.length >= 4);
  }
  return syntheses.length >= 2 || (syntheses.length >= 1 && direct.length >= 3) || direct.length >= 4;
}

function selectChatSources(rankedArticles = [], intent = {}) {
  const ranked = Array.isArray(rankedArticles) ? rankedArticles : [];
  const comparison = isComparisonIntent(intent);
  const usable = ranked.filter(isUsableEvidence);

  if (!usable.length) {
    return {
      articles: ranked.slice(0, MAX_CLOSEST_WHEN_NONE_APPLIES),
      diagnostics: { version: "1.0.0", rule: "none_applicable_closest", usable: 0, selected: Math.min(ranked.length, MAX_CLOSEST_WHEN_NONE_APPLIES) },
    };
  }

  const anyDirect = usable.some((article) => tierOf(article) === "direct");
  const max = !anyDirect ? MAX_WITHOUT_DIRECT : comparison ? MAX_COMPARISON_SOURCES : MAX_SOURCES;
  const selected = [];
  let rule = "max_reached";
  for (const article of usable) {
    selected.push(article);
    if (selected.length >= max) break;
    if (selected.length >= MIN_SOURCES && coreCovered(selected, comparison)) {
      rule = "core_covered";
      break;
    }
  }
  if (selected.length < max && rule !== "core_covered") rule = "all_usable";

  // Never answer from a single source: add the next ranked one as context.
  for (const article of ranked) {
    if (selected.length >= MIN_SOURCES) break;
    if (!selected.includes(article)) selected.push(article);
  }

  // Keep the P0 ranking order.
  const ordered = ranked.filter((article) => selected.includes(article));
  return {
    articles: ordered,
    diagnostics: {
      version: "1.0.0",
      rule,
      usable: usable.length,
      selected: ordered.length,
      max,
    },
  };
}

module.exports = {
  MIN_SOURCES,
  MAX_SOURCES,
  MAX_COMPARISON_SOURCES,
  selectChatSources,
};
