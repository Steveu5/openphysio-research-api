// Collapses records that are the same evidence:
//   - same DOI or PMID, even when each source only carried one of them;
//   - equivalent titles (case, punctuation, trailing period, preprint vs
//     published);
//   - versions of the same guideline (original, revision, update, summary of
//     recommendations), keeping the most recent;
//   - a Library guide and its original publication, keeping the Library entry
//     (it carries the study links) enriched with the external identifiers.
// Guidelines whose titles differ in clinical content (another condition,
// population or subgroup) are clinically distinct and are never merged.

const VERSION = "1.0.0";

function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeDoi(value = "") {
  return normalizeText(value)
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")
    .replace(/^doi:\s*/, "")
    .replace(/[\s.,;:]+$/, "");
}

// Letters and replies about an article ("RE: <title>") are the same
// evidence as the article itself.
const COMMENTARY_PREFIX = /^\s*(?:re|reply|response to|comment on|commentary on)\s*[:\-]\s*/i;

function isCommentary(article = {}) {
  return COMMENTARY_PREFIX.test(String(article.title || ""));
}

function titleKey(title = "") {
  return normalizeText(String(title || "").replace(COMMENTARY_PREFIX, ""))
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Words that distinguish versions or publication formats of one guideline,
// not its clinical content.
const VERSION_WORDS = new Set([
  "revision", "revised", "update", "updated", "version", "edition",
  "clinical", "practice", "guideline", "guidelines", "cpg", "summary", "recommendations",
  "recommendation", "a", "an", "the", "of", "and", "for", "to", "in", "from", "with",
  "linked", "international", "classification", "functioning", "disability", "health",
  "orthopaedic", "orthopedic", "section", "academy", "american", "physical", "therapy",
  "association", "journal", "sports", "jospt", "icf",
]);

function familyTokens(title = "") {
  return titleKey(title)
    .split(" ")
    .filter((token) => token && !/^\d+$/.test(token) && !VERSION_WORDS.has(token));
}

function isGuidelineRecord(article = {}) {
  if (article.library_resource) return true;
  const text = normalizeText(`${article.study_type || ""} ${article.evidence_level || ""} ${article.title || ""}`);
  return /guideline|guia de practica/.test(text);
}

// Same guideline family when the clinical words are the same, e.g.
// "Neck Pain. CPGs linked to the ICF (2008)" and "Neck Pain: Revision 2017".
function sameGuidelineFamily(left = {}, right = {}) {
  if (!isGuidelineRecord(left) || !isGuidelineRecord(right)) return false;
  const a = new Set(familyTokens(left.title));
  const b = new Set(familyTokens(right.title));
  if (a.size < 2 || b.size < 2) return false;
  const shared = [...a].filter((token) => b.has(token)).length;
  return shared === a.size && shared === b.size;
}

function isSummaryFormat(article = {}) {
  return /\bsummary of\b|\bfor patients\b/.test(normalizeText(article.title));
}

// Which record represents the family: the most recent version (a newer
// external revision beats an older Library guide), then the Library entry
// for the same publication, then the full guideline over a summary.
function preferredRecord(current, incoming) {
  const commentaryDiff = Number(isCommentary(current)) - Number(isCommentary(incoming));
  if (commentaryDiff) return commentaryDiff > 0 ? incoming : current;
  const currentYear = Number(current.year || current.library_resource?.publication_year || 0);
  const incomingYear = Number(incoming.year || incoming.library_resource?.publication_year || 0);
  if (currentYear && incomingYear && currentYear !== incomingYear) {
    return incomingYear > currentYear ? incoming : current;
  }
  const libraryDiff = Number(Boolean(incoming.library_resource)) - Number(Boolean(current.library_resource));
  if (libraryDiff) return libraryDiff > 0 ? incoming : current;
  const summaryDiff = Number(isSummaryFormat(current)) - Number(isSummaryFormat(incoming));
  if (summaryDiff) return summaryDiff > 0 ? incoming : current;
  return String(incoming.abstract || "").length > String(current.abstract || "").length ? incoming : current;
}

function mergeRecords(kept, other, reason) {
  const superseded = [
    ...(kept.superseded_versions || []),
    ...(other.superseded_versions || []),
    { title: other.title || null, year: other.year || null, reason },
  ];
  return {
    ...kept,
    doi: kept.doi || other.doi || null,
    pmid: kept.pmid || other.pmid || null,
    pmcid: kept.pmcid || other.pmcid || null,
    abstract: kept.abstract || other.abstract || null,
    superseded_versions: superseded.slice(0, 5),
  };
}

function sameIdentity(left = {}, right = {}) {
  const leftDoi = normalizeDoi(left.doi);
  const rightDoi = normalizeDoi(right.doi);
  if (leftDoi && rightDoi && leftDoi === rightDoi) return "same_doi";
  if (left.pmid && right.pmid && String(left.pmid) === String(right.pmid)) return "same_pmid";
  const leftTitle = titleKey(left.title || left.library_resource?.title);
  const rightTitle = titleKey(right.title || right.library_resource?.title);
  if (leftTitle.length >= 18 && leftTitle === rightTitle) return "equivalent_title";
  return null;
}

function collapseEquivalentEvidence(articles = []) {
  const kept = [];
  let collapsed = 0;

  for (const article of Array.isArray(articles) ? articles : []) {
    if (!article) continue;
    let merged = false;
    for (let index = 0; index < kept.length; index += 1) {
      const current = kept[index];
      const reason =
        sameIdentity(current, article) ||
        (sameGuidelineFamily(current, article) ? "guideline_version" : null);
      if (!reason) continue;

      const preferred = preferredRecord(current, article);
      const other = preferred === current ? article : current;
      // The merged record keeps the position of the first occurrence.
      kept[index] = mergeRecords(preferred, other, reason);
      collapsed += 1;
      merged = true;
      break;
    }
    if (!merged) kept.push(article);
  }

  return { articles: kept, collapsed, version: VERSION };
}

module.exports = {
  VERSION,
  sameGuidelineFamily,
  collapseEquivalentEvidence,
};
