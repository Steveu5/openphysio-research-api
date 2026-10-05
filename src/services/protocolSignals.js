// Detects study protocols from how the abstract is written, not from a title
// keyword. A protocol describes planned methods in the future tense ("will be
// searched", "two reviewers will screen") and reports no results. Completed
// studies may mention future research once, but they also report results
// ("were included", "RESULTS:"), which always wins.

const FUTURE_PASSIVE =
  /\bwill (?:then |also |subsequently |independently )?be (conducted|searched|included|excluded|screened|extracted|assessed|evaluated|performed|undertaken|pooled|synthesi[sz]ed|calculated|analy[sz]ed|recruited|randomi[sz]ed|registered|appraised|summari[sz]ed)\b/g;
const FUTURE_ACTIVE =
  /\b(?:we|reviewers|investigators|authors|researchers) will (?:independently )?(search|include|conduct|screen|extract|assess|evaluate|perform|pool|synthesi[sz]e|analy[sz]e|recruit|randomi[sz]e|appraise|summari[sz]e)\b/g;

const RESULTS_REPORTED = [
  /\bresults?\s*:/,
  /\bconclusions?\s*:/,
  /\b(?:we|were) included\b/,
  /\bwe found\b/,
  /\bresults (?:showed|show|suggest|suggested|indicate|indicated|revealed)\b/,
  /\b(?:studies|trials|articles|participants|patients) were (?:identified|analy[sz]ed|randomi[sz]ed|enrolled)\b/,
  /\bmeta-analys[ie]s (?:was|were) performed\b/,
];

const PROTOCOL_STATEMENTS = [
  "this is a protocol for",
  "protocol for a cochrane review",
  "this is the protocol",
];

function normalizeAbstract(abstract = "") {
  return String(abstract || "").toLowerCase().replace(/\s+/g, " ");
}

function countPlannedMethodVerbs(abstract = "") {
  const text = normalizeAbstract(abstract);
  const verbs = new Set();
  for (const pattern of [FUTURE_PASSIVE, FUTURE_ACTIVE]) {
    for (const match of text.matchAll(pattern)) verbs.add(match[1]);
  }
  return verbs.size;
}

function reportsResults(abstract = "") {
  const text = normalizeAbstract(abstract);
  return RESULTS_REPORTED.some((pattern) => pattern.test(text));
}

// True when the abstract states it is a protocol (Cochrane wording), or
// describes at least two distinct planned methods steps without results.
function describesPlannedStudy(abstract = "") {
  const text = normalizeAbstract(abstract);
  if (!text) return false;
  if (PROTOCOL_STATEMENTS.some((statement) => text.includes(statement))) return true;
  return countPlannedMethodVerbs(text) >= 2 && !reportsResults(text);
}

module.exports = {
  describesPlannedStudy,
  countPlannedMethodVerbs,
  reportsResults,
};
