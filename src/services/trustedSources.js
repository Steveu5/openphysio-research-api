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
      "cochrane library",
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
      "physical therapy",
      "physical therapy and rehabilitation journal",
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
      "sports medicine",
      "sports medicine open",
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

function calculateTrustedSourceBoost(article = {}) {
  const sourceText = normalizeSourceText([
    article.source_name,
    article.journal,
    article.title,
    article.abstract,
    article.study_type,
  ].filter(Boolean).join(" "));

  let bestMatch = null;

  for (const rule of TRUSTED_SOURCE_RULES) {
    const matches = rule.terms.some((term) =>
      sourceText.includes(normalizeSourceText(term))
    );

    if (!matches) continue;

    if (!bestMatch || rule.score > bestMatch.score) {
      bestMatch = rule;
    }
  }

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
};
