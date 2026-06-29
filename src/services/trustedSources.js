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
    label: "PEDro",
    score: 20,
    terms: ["physiotherapy evidence database", "pedro"],
  },
  {
    label: "Cochrane",
    score: 18,
    terms: [
      "cochrane database of systematic reviews",
      "cochrane database syst rev",
      "cochrane review",
      "cochrane back and neck",
    ],
  },
  {
    label: "JOSPT",
    score: 18,
    terms: [
      "journal of orthopaedic and sports physical therapy",
      "journal of orthopedic and sports physical therapy",
      "j orthop sports phys ther",
      "jospt",
    ],
  },
  {
    label: "Journal of Physiotherapy",
    score: 17,
    terms: ["journal of physiotherapy", "j physiother"],
  },
  {
    label: "PTJ / APTA",
    score: 17,
    terms: [
      "physical therapy and rehabilitation journal",
      "ptj",
    ],
    exactTerms: [
      "physical therapy",
      "phys ther",
    ],
  },
  {
    label: "Physiotherapy",
    score: 16,
    terms: [],
    exactTerms: ["physiotherapy"],
  },
  {
    label: "IJSPT",
    score: 16,
    terms: [
      "international journal of sports physical therapy",
      "int j sports phys ther",
      "ijspt",
    ],
  },
  {
    label: "Musculoskeletal Science and Practice",
    score: 15,
    terms: [
      "musculoskeletal science and practice",
      "musculoskelet sci pract",
    ],
  },
  {
    label: "AAOS / JAAOS",
    score: 16,
    terms: [
      "journal of the american academy of orthopaedic surgeons",
      "j am acad orthop surg",
      "jaaos",
    ],
  },
  {
    label: "BJSM",
    score: 14,
    terms: [
      "british journal of sports medicine",
      "br j sports med",
      "bjsm",
    ],
  },
  {
    label: "Clinical Rehabilitation",
    score: 13,
    terms: ["clinical rehabilitation", "clin rehabil"],
  },
  {
    label: "Archives of Physical Medicine and Rehabilitation",
    score: 13,
    terms: [
      "archives of physical medicine and rehabilitation",
      "arch phys med rehabil",
    ],
  },
  {
    label: "Sports Medicine",
    score: 12,
    terms: ["sports medicine open", "sports medicine", "sports med"],
  },
];

const GUIDELINE_SOURCE_RULES = [
  {
    label: "APTA / Academy CPG",
    score: 18,
    terms: [
      "academy of orthopaedic physical therapy",
      "orthopaedic section",
      "american physical therapy association",
      "apta",
    ],
  },
  {
    label: "AAOS / OrthoGuidelines",
    score: 17,
    terms: [
      "american academy of orthopaedic surgeons",
      "aaos",
      "orthoguidelines",
    ],
  },
];

const PROFESSIONAL_PUBMED_SOURCE_CLAUSES = [
  '"J Orthop Sports Phys Ther"[jour]',
  '"Phys Ther"[jour]',
  '"J Physiother"[jour]',
  '"Physiotherapy"[jour]',
  '"Int J Sports Phys Ther"[jour]',
  '"Musculoskelet Sci Pract"[jour]',
  '"J Am Acad Orthop Surg"[jour]',
  '"Br J Sports Med"[jour]',
  '"Clin Rehabil"[jour]',
  '"Arch Phys Med Rehabil"[jour]',
  '"Sports Med"[jour]',
  '"Cochrane Database Syst Rev"[jour]',
  '"American Physical Therapy Association"[Corporate Author]',
  '"Academy of Orthopaedic Physical Therapy"[Title/Abstract]',
  '"American Academy of Orthopaedic Surgeons"[Corporate Author]',
  'AAOS[Title/Abstract]',
  'OrthoGuidelines[Title/Abstract]',
];

function matchBestRule(text, rules, exactText = "") {
  let bestMatch = null;

  for (const rule of rules) {
    const exactMatch = (rule.exactTerms || [])
      .map(normalizeSourceText)
      .includes(exactText);

    const containsMatch = (rule.terms || []).some((term) =>
      text.includes(normalizeSourceText(term))
    );

    if (!exactMatch && !containsMatch) continue;

    if (!bestMatch || rule.score > bestMatch.score) {
      bestMatch = rule;
    }
  }

  return bestMatch;
}

function identifyProfessionalSource(article = {}) {
  const journalText = normalizeSourceText(article.journal);

  const journalAndSourceText = normalizeSourceText([
    article.source_name,
    article.journal,
  ].filter(Boolean).join(" "));

  const titleAndStudyTypeText = normalizeSourceText([
    article.title,
    article.study_type,
  ].filter(Boolean).join(" "));

  const journalMatch = matchBestRule(
    journalAndSourceText,
    TRUSTED_SOURCE_RULES,
    journalText
  );

  const guidelineMatch = matchBestRule(
    `${journalAndSourceText} ${titleAndStudyTypeText}`,
    GUIDELINE_SOURCE_RULES
  );

  const bestMatch = [journalMatch, guidelineMatch]
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)[0] || null;

  if (!bestMatch) return null;

  return {
    label: bestMatch.label,
    score: bestMatch.score,
  };
}

function applyProfessionalSource(article = {}) {
  const match = identifyProfessionalSource(article);
  if (!match) return null;

  return {
    ...article,
    retrieval_source_name: article.source_name || null,
    source_name: match.label,
    professional_source_label: match.label,
    professional_source_score: match.score,
  };
}

function filterProfessionalArticles(articles = []) {
  return articles
    .map(applyProfessionalSource)
    .filter(Boolean);
}

function buildProfessionalPubMedQuery(query = "") {
  const cleanQuery = String(query || "").trim();

  return (
    `(${cleanQuery}) AND (` +
    `${PROFESSIONAL_PUBMED_SOURCE_CLAUSES.join(" OR ")})`
  );
}

function calculateTrustedSourceBoost(article = {}) {
  const match = identifyProfessionalSource(article);

  if (!match) {
    return {
      score: 0,
      reason: null,
      source_label: null,
    };
  }

  return {
    score: match.score,
    reason: `Fuente preferente: ${match.label}`,
    source_label: match.label,
  };
}

module.exports = {
  calculateTrustedSourceBoost,
  identifyProfessionalSource,
  applyProfessionalSource,
  filterProfessionalArticles,
  buildProfessionalPubMedQuery,
  TRUSTED_SOURCE_RULES,
  GUIDELINE_SOURCE_RULES,
  PROFESSIONAL_PUBMED_SOURCE_CLAUSES,
};
