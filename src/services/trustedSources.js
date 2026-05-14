function normalizeSourceText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TRUSTED_SOURCE_RULES = [
  {
    label: "Cochrane",
    score: 16,
    terms: [
      "cochrane database of systematic reviews",
      "cochrane review",
      "cochrane back and neck",
    ],
  },
  {
    label: "JOSPT",
    score: 14,
    terms: [
      "journal of orthopaedic and sports physical therapy",
      "journal of orthopedic and sports physical therapy",
      "j orthop sports phys ther",
      "jospt",
    ],
  },
  {
    label: "Journal of Physiotherapy",
    score: 14,
    terms: [
      "journal of physiotherapy",
      "j physiother",
    ],
  },
  {
    label: "PTJ / Physical Therapy",
    score: 12,
    terms: [
      "physical therapy and rehabilitation journal",
      "physical therapy",
      "ptj",
    ],
  },
  {
    label: "BJSM",
    score: 12,
    terms: [
      "british journal of sports medicine",
      "bjsm",
    ],
  },
  {
    label: "Sports Medicine",
    score: 10,
    terms: [
      "sports medicine open",
      "sports medicine",
    ],
  },
  {
    label: "Clinical Rehabilitation",
    score: 10,
    terms: [
      "clinical rehabilitation",
    ],
  },
  {
    label: "Archives of Physical Medicine and Rehabilitation",
    score: 10,
    terms: [
      "archives of physical medicine and rehabilitation",
      "arch phys med rehabil",
    ],
  },
];

const GUIDELINE_SOURCE_RULES = [
  {
    label: "APTA / Academy CPG",
    score: 14,
    terms: [
      "academy of orthopaedic physical therapy",
      "orthopaedic section",
      "american physical therapy association",
      "apta",
    ],
  },
  {
    label: "NICE guideline",
    score: 12,
    terms: [
      "national institute for health and care excellence",
      "nice guideline",
      "nice guidelines",
    ],
  },
  {
    label: "AAOS guideline",
    score: 10,
    terms: [
      "american academy of orthopaedic surgeons",
      "aaos",
    ],
  },
];

function matchBestRule(text, rules) {
  let bestMatch = null;

  for (const rule of rules) {
    const matches = rule.terms.some((term) =>
      text.includes(normalizeSourceText(term))
    );

    if (!matches) continue;

    if (!bestMatch || rule.score > bestMatch.score) {
      bestMatch = rule;
    }
  }

  return bestMatch;
}

function calculateTrustedSourceBoost(article = {}) {
  const journalAndSourceText = normalizeSourceText([
    article.source_name,
    article.journal,
  ].filter(Boolean).join(" "));

  const titleAndStudyTypeText = normalizeSourceText([
    article.title,
    article.study_type,
  ].filter(Boolean).join(" "));

  // Journal/source boosts must come from the actual source/journal field.
  // Do not treat mentions inside abstracts such as "searched Cochrane Library"
  // or "searched PEDro" as the article's source.
  const journalMatch = matchBestRule(journalAndSourceText, TRUSTED_SOURCE_RULES);

  // Guideline organizations may appear in titles/study types when imported from
  // generic sources, so they are allowed in title/study_type but not abstract.
  const guidelineMatch = matchBestRule(
    `${journalAndSourceText} ${titleAndStudyTypeText}`,
    GUIDELINE_SOURCE_RULES
  );

  const bestMatch = [journalMatch, guidelineMatch]
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)[0] || null;

  if (!bestMatch) {
    return { score: 0, reason: null, source_label: null };
  }

  return {
    score: bestMatch.score,
    reason: `Fuente preferente: ${bestMatch.label}`,
    source_label: bestMatch.label,
  };
}

module.exports = {
  calculateTrustedSourceBoost,
  TRUSTED_SOURCE_RULES,
  GUIDELINE_SOURCE_RULES,
};
