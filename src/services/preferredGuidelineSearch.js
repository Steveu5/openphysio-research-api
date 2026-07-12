function normalizeClinicalText(value = "") {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTerm(value = "") {
  return String(value || "")
    .replace(/[()"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CONDITION_CONCEPTS = [
  {
    id: "low_back_pain",
    triggers: ["low back pain", "lumbar pain", "lumbago", "mechanical low back", "dolor lumbar", "lumbalgia"],
    aliases: ["low back pain", "chronic low back pain", "acute low back pain", "lumbar pain", "lumbago", "nonspecific low back pain", "non-specific low back pain", "mechanical low back pain"],
    guidelineTerms: ["low back pain", "acute and chronic low back pain"],
  },
  {
    id: "neck_pain",
    triggers: ["neck pain", "cervical pain", "cervicalgia", "mechanical neck", "dolor de cuello", "dolor cervical"],
    aliases: ["neck pain", "cervical pain", "cervical spine pain", "cervicalgia", "mechanical neck pain", "nonspecific neck pain", "non-specific neck pain"],
    guidelineTerms: ["neck pain", "mechanical neck pain"],
  },
  {
    id: "headache",
    triggers: ["headache", "head pain", "cephalalgia", "cervicogenic headache", "tension-type headache", "migraine", "dolor de cabeza", "cefalea"],
    aliases: ["headache", "head pain", "cephalalgia", "cervicogenic headache", "tension-type headache", "tension type headache", "migraine"],
    guidelineTerms: ["cervicogenic headache", "headache", "tension-type headache"],
  },
  {
    id: "cervical_radiculopathy",
    triggers: ["cervical radiculopathy", "cervical radicular pain", "cervicobrachial pain"],
    aliases: ["cervical radiculopathy", "cervical radicular pain", "cervicobrachial pain", "cervical nerve root compression"],
    guidelineTerms: ["cervical radiculopathy", "neck pain with radiating pain"],
  },
  {
    id: "shoulder_rotator_cuff",
    triggers: ["rotator cuff", "shoulder pain", "subacromial pain", "shoulder impingement", "dolor de hombro", "manguito rotador"],
    aliases: ["rotator cuff related shoulder pain", "rotator cuff-related shoulder pain", "rotator cuff tendinopathy", "shoulder pain", "subacromial pain syndrome", "shoulder impingement"],
    guidelineTerms: ["rotator cuff related shoulder pain", "shoulder pain"],
  },
  {
    id: "knee_osteoarthritis",
    triggers: ["knee osteoarthritis", "osteoarthritis of the knee", "knee oa", "gonarthrosis", "artrosis de rodilla"],
    aliases: ["knee osteoarthritis", "osteoarthritis of the knee", "knee oa", "gonarthrosis"],
    guidelineTerms: ["knee osteoarthritis"],
  },
  {
    id: "hip_osteoarthritis",
    triggers: ["hip osteoarthritis", "osteoarthritis of the hip", "hip oa", "coxarthrosis", "artrosis de cadera"],
    aliases: ["hip osteoarthritis", "osteoarthritis of the hip", "hip oa", "coxarthrosis"],
    guidelineTerms: ["hip osteoarthritis"],
  },
  {
    id: "patellofemoral_pain",
    triggers: ["patellofemoral pain", "anterior knee pain", "patellofemoral syndrome"],
    aliases: ["patellofemoral pain", "patellofemoral pain syndrome", "anterior knee pain", "patellofemoral syndrome"],
    guidelineTerms: ["patellofemoral pain"],
  },
  {
    id: "achilles_tendinopathy",
    triggers: ["achilles tendinopathy", "achilles tendon pain", "midportion achilles", "insertional achilles", "tendinopatia aquilea"],
    aliases: ["achilles tendinopathy", "achilles tendon pain", "midportion achilles tendinopathy", "mid-portion achilles tendinopathy", "insertional achilles tendinopathy"],
    guidelineTerms: ["achilles tendinopathy"],
  },
  {
    id: "patellar_tendinopathy",
    triggers: ["patellar tendinopathy", "patellar tendon pain", "jumpers knee"],
    aliases: ["patellar tendinopathy", "patellar tendon pain", "jumpers knee"],
    guidelineTerms: ["patellar tendinopathy"],
  },
  {
    id: "lateral_elbow_tendinopathy",
    triggers: ["lateral elbow tendinopathy", "lateral epicondylalgia", "tennis elbow"],
    aliases: ["lateral elbow tendinopathy", "lateral epicondylalgia", "lateral epicondylitis", "tennis elbow"],
    guidelineTerms: ["lateral elbow tendinopathy"],
  },
  {
    id: "plantar_heel_pain",
    triggers: ["plantar heel pain", "plantar fasciitis", "plantar fasciopathy"],
    aliases: ["plantar heel pain", "plantar fasciitis", "plantar fasciopathy"],
    guidelineTerms: ["plantar heel pain", "plantar fasciitis"],
  },
  {
    id: "lateral_ankle_sprain",
    triggers: ["lateral ankle sprain", "ankle sprain", "chronic ankle instability"],
    aliases: ["lateral ankle sprain", "ankle sprain", "chronic ankle instability", "functional ankle instability"],
    guidelineTerms: ["lateral ankle sprain", "chronic ankle instability"],
  },
];

function getIntentConditionText(intent = {}) {
  return normalizeClinicalText([
    intent.condition,
    intent.body_region,
    intent.normalized_query,
    ...(Array.isArray(intent.search_terms) ? intent.search_terms : []),
  ].filter(Boolean).join(" "));
}

function resolveConditionConcepts(intent = {}) {
  const intentText = getIntentConditionText(intent);
  if (!intentText) return [];

  return CONDITION_CONCEPTS.filter((concept) =>
    concept.triggers.some((trigger) =>
      intentText.includes(normalizeClinicalText(trigger))
    )
  );
}

function getFallbackConditionTerms(intent = {}) {
  const combined = [intent.condition, intent.body_region]
    .map(normalizeClinicalText)
    .filter(Boolean)
    .join(" ");
  if (!combined) return [];

  return Array.from(new Set(
    combined
      .split(/\b(?:and|or|with|y|o|con)\b|[,;/+]/i)
      .map(normalizeClinicalText)
      .filter((term) => term.length >= 4)
  ));
}

function getConditionTerms(intent = {}) {
  const concepts = resolveConditionConcepts(intent);
  const terms = concepts.flatMap((concept) => concept.aliases);

  if (terms.length === 0) terms.push(...getFallbackConditionTerms(intent));

  return Array.from(new Set(
    terms.map(normalizeClinicalText).filter((term) => term.length >= 4)
  ));
}

function getGuidelineConditionTerms(intent = {}) {
  const concepts = resolveConditionConcepts(intent);
  if (concepts.length > 0) {
    return Array.from(new Set(
      concepts.flatMap((concept) => concept.guidelineTerms)
    ));
  }

  return getFallbackConditionTerms(intent).slice(0, 3);
}

function getConditionMatchDetails(article = {}, intent = {}) {
  const targetConcepts = resolveConditionConcepts(intent);
  const targetIds = new Set(targetConcepts.map((concept) => concept.id));
  const targetTerms = getConditionTerms(intent);
  const articleText = normalizeClinicalText(`${article.title || ""} ${article.abstract || ""}`);
  const titleText = normalizeClinicalText(article.title);
  const matchedTargetTerms = targetTerms.filter((term) => articleText.includes(term));
  const competingConcepts = CONDITION_CONCEPTS.filter(
    (concept) => !targetIds.has(concept.id)
  ).filter((concept) =>
    concept.aliases.some((alias) => titleText.includes(normalizeClinicalText(alias)))
  );

  return {
    targetTerms,
    matchedTargetTerms,
    hasTargetMatch: targetTerms.length === 0 || matchedTargetTerms.length > 0,
    competingConditionIds: competingConcepts.map((concept) => concept.id),
    hasCompetingTitleCondition: competingConcepts.length > 0,
  };
}

function buildPreferredGuidelineQueries(intent = {}, originalQuery = "") {
  const condition = cleanTerm(intent.condition || intent.normalized_query || originalQuery);
  const bodyRegion = cleanTerm(intent.body_region || "");
  const baseCondition = condition || bodyRegion;
  if (!baseCondition) return [];

  const guidelineTerms = getGuidelineConditionTerms(intent);
  const searchBases = guidelineTerms.length > 0 ? guidelineTerms : [baseCondition];
  const queryTargets = [];

  for (const term of searchBases) {
    queryTargets.push(
      `"${term}" "clinical practice guideline" physiotherapy`,
      `"${term}" "clinical practice guideline" "physical therapy"`,
      `"${term}" JOSPT guideline`,
      `"${term}" APTA guideline`
    );
  }

  if (bodyRegion && !searchBases.some((term) => normalizeClinicalText(term) === normalizeClinicalText(bodyRegion))) {
    queryTargets.push(`"${bodyRegion}" "clinical practice guideline" physiotherapy`);
  }

  return Array.from(new Set(queryTargets)).slice(0, 4);
}

module.exports = {
  CONDITION_CONCEPTS,
  normalizeClinicalText,
  resolveConditionConcepts,
  getConditionTerms,
  getGuidelineConditionTerms,
  getConditionMatchDetails,
  buildPreferredGuidelineQueries,
};
