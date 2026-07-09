function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CONDITION_GROUPS = [
  {
    id: "low_back_pain",
    synonyms: [
      "low back pain",
      "lumbar pain",
      "lumbar spine pain",
      "lumbago",
      "nonspecific low back pain",
      "non-specific low back pain",
      "dolor lumbar",
      "lumbalgia",
    ],
  },
  {
    id: "neck_pain",
    synonyms: [
      "neck pain",
      "cervical pain",
      "cervical spine pain",
      "mechanical neck pain",
      "nonspecific neck pain",
      "non-specific neck pain",
      "cervicalgia",
      "dolor de cuello",
      "dolor cervical",
    ],
  },
  {
    id: "headache",
    synonyms: [
      "headache",
      "head pain",
      "cephalalgia",
      "cervicogenic headache",
      "tension-type headache",
      "tension type headache",
      "migraine",
      "dolor de cabeza",
      "cefalea",
      "cefalea cervicogenica",
    ],
  },
  {
    id: "shoulder_pain",
    synonyms: [
      "shoulder pain",
      "rotator cuff",
      "subacromial pain",
      "shoulder impingement",
      "dolor de hombro",
      "manguito rotador",
    ],
  },
  {
    id: "achilles_tendinopathy",
    synonyms: [
      "achilles tendinopathy",
      "achilles tendon",
      "midportion achilles",
      "insertional achilles",
      "tendinopatia aquilea",
      "tendon de aquiles",
    ],
  },
  {
    id: "knee_pain",
    synonyms: [
      "knee pain",
      "patellofemoral pain",
      "knee osteoarthritis",
      "anterior knee pain",
      "dolor de rodilla",
      "artrosis de rodilla",
    ],
  },
  {
    id: "hip_pain",
    synonyms: [
      "hip pain",
      "hip osteoarthritis",
      "femoroacetabular impingement",
      "femoroacetabular pain",
      "dolor de cadera",
      "pinzamiento femoroacetabular",
    ],
  },
  {
    id: "ankle_pain",
    synonyms: [
      "ankle pain",
      "ankle sprain",
      "chronic ankle instability",
      "dolor de tobillo",
      "esguince de tobillo",
    ],
  },
  {
    id: "elbow_pain",
    synonyms: [
      "elbow pain",
      "lateral epicondylalgia",
      "lateral epicondylitis",
      "tennis elbow",
      "dolor de codo",
      "epicondilalgia lateral",
    ],
  },
];

const SPLIT_PATTERN = /\b(?:and|or|with|associated with|y|o|con)\b|[,;/+]/i;
const STOPWORDS = new Set([
  "pain",
  "dolor",
  "condition",
  "disorder",
  "syndrome",
  "adult",
  "adults",
  "patient",
  "patients",
  "chronic",
  "acute",
  "subacute",
  "and",
  "or",
  "with",
  "the",
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "en",
  "con",
  "para",
]);

function getIntentConditionText(intent = {}) {
  return normalizeText(
    [
      intent.condition,
      intent.body_region,
      intent.normalized_query,
      ...(Array.isArray(intent.search_terms) ? intent.search_terms : []),
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function getFallbackGroups(intent = {}) {
  const raw = normalizeText(
    [intent.condition, intent.body_region].filter(Boolean).join(" ")
  );
  if (!raw) return [];

  const parts = raw
    .split(SPLIT_PATTERN)
    .map((part) => normalizeText(part))
    .filter(Boolean);

  const groups = parts
    .map((part, index) => {
      const tokens = part
        .split(" ")
        .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
      const terms = Array.from(new Set([part, ...tokens])).filter(
        (term) => term.length >= 4
      );

      return terms.length
        ? { id: `fallback_${index}`, synonyms: terms }
        : null;
    })
    .filter(Boolean);

  if (groups.length) return groups;

  const tokens = raw
    .split(" ")
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));

  return tokens.length
    ? [{ id: "fallback", synonyms: Array.from(new Set(tokens)) }]
    : [];
}

function getConditionConceptGroups(intent = {}) {
  const intentText = getIntentConditionText(intent);
  if (!intentText) return [];

  const matched = CONDITION_GROUPS.filter((group) =>
    group.synonyms.some((term) => intentText.includes(normalizeText(term)))
  ).map((group) => ({
    ...group,
    synonyms: Array.from(
      new Set(group.synonyms.map((term) => normalizeText(term)).filter(Boolean))
    ),
  }));

  return matched.length ? matched : getFallbackGroups(intent);
}

function getConditionMatch(article = {}, intent = {}) {
  const groups = getConditionConceptGroups(intent);
  if (!groups.length) {
    return {
      matches: true,
      matched_groups: [],
      unmatched_groups: [],
      group_count: 0,
      matched_count: 0,
      ratio: 1,
      title_matched_count: 0,
    };
  }

  const title = normalizeText(article.title);
  const text = normalizeText(
    [article.title, article.abstract]
      .filter(Boolean)
      .join(" ")
  );

  const matchedGroups = [];
  const unmatchedGroups = [];
  let titleMatchedCount = 0;

  for (const group of groups) {
    const matched = group.synonyms.some((term) => text.includes(term));
    const titleMatched = group.synonyms.some((term) => title.includes(term));

    if (matched) matchedGroups.push(group.id);
    else unmatchedGroups.push(group.id);
    if (titleMatched) titleMatchedCount += 1;
  }

  return {
    matches: matchedGroups.length > 0,
    matched_groups: matchedGroups,
    unmatched_groups: unmatchedGroups,
    group_count: groups.length,
    matched_count: matchedGroups.length,
    ratio: matchedGroups.length / groups.length,
    title_matched_count: titleMatchedCount,
  };
}

function getConditionTerms(intent = {}) {
  return Array.from(
    new Set(
      getConditionConceptGroups(intent).flatMap((group) => group.synonyms)
    )
  );
}

module.exports = {
  CONDITION_GROUPS,
  normalizeText,
  getConditionConceptGroups,
  getConditionMatch,
  getConditionTerms,
};
