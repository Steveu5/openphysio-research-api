// Clinical match ranking shared by Chat and Research.
//
// Every candidate (external article or Library guide) is compared with the
// parsed clinical question component by component: condition, intervention,
// comparator, population, outcome and question-type fit, plus study design
// and recency. The components decide an applicability tier:
//
//   direct      same condition (or none asked) and the asked intervention
//               (and, for comparisons, both arms in the same study)
//   partial     same condition, but not the asked intervention/comparison
//   tangential  only the body region, or a different condition
//
// Candidates are ordered by tier first, so a tangential systematic review can
// never outrank a direct trial, and then by a mode-specific score:
// Chat favors applicability, Research gives design and recency more weight.
// Every article keeps a `clinical_match` trace explaining its position.

const { normalizeText } = require("./clinicalQuestion");

const VERSION = "1.0.0";

const STOPWORDS = new Set([
  "and", "or", "with", "without", "the", "for", "of", "in", "on", "to", "a", "an",
  "de", "del", "la", "el", "los", "las", "en", "con", "sin", "para", "por", "y", "o",
  "pain", "dolor", "patients", "patient", "pacientes", "adults", "adult", "people",
  "chronic", "acute", "subacute", "cronico", "cronica", "agudo", "aguda",
  "therapy", "treatment", "tratamiento", "terapia", "management", "manejo",
  "effect", "effects", "efecto", "program", "programme", "programa",
  "clinical", "clinica", "clinico", "based", "type", "training", "entrenamiento",
]);

// Word families that must match each other and nothing else, so that
// "patellar" never matches "patellofemoral".
const WORD_FAMILIES = [
  [/^(?:tendin\w*|tendon\w*|tendinosis|tendinitis)$/, "tendon"],
  [/^(?:osteoarthrit\w*|arthros\w*|artros\w*|osteoartrit\w*|oa)$/, "osteoarthritis"],
  [/^(?:eccentric\w*|excentric\w*)$/, "eccentric"],
  [/^(?:isometric\w*|isometric\w*)$/, "isometric"],
  [/^(?:concentric\w*)$/, "concentric"],
  [/^(?:strength\w*|resistance|resisted)$/, "strength"],
  [/^(?:exercis\w*|ejercicio\w*)$/, "exercise"],
  [/^(?:needl\w*|puncion)$/, "needling"],
  [/^(?:manipulat\w*|mobili[sz]\w*|manual)$/, "manual"],
  [/^(?:patella|patellar|rotuliana|rotuliano|rotula)$/, "patella"],
  [/^(?:achilles|aquiles|aquilea|aquileo)$/, "achilles"],
  [/^(?:sprain\w*|esguince\w*)$/, "sprain"],
  [/^(?:shoulder\w*|hombro)$/, "shoulder"],
  [/^(?:knee\w*|rodilla)$/, "knee"],
  [/^(?:ankle\w*|tobillo)$/, "ankle"],
  [/^(?:hip|hips|cadera)$/, "hip"],
  [/^(?:neck|cervical|cuello)$/, "neck"],
  [/^(?:lumbar|lowback|lumbalgia)$/, "lowback"],
];

function stem(word = "") {
  for (const [pattern, family] of WORD_FAMILIES) {
    if (pattern.test(word)) return family;
  }
  return word.replace(/(?:ies)$/, "y").replace(/(?<=\w{3})(?:es|s)$/, "");
}

function tokenize(text = "") {
  return normalizeText(text)
    .replace(/low[-\s]+back/g, "lowback")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function stemSet(text = "") {
  return new Set(tokenize(text).map(stem));
}

function significantStems(text = "") {
  return Array.from(
    new Set(
      tokenize(text)
        .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
        .map(stem)
    )
  );
}

function phraseIn(text = "", phrase = "") {
  const normalizedPhrase = normalizeText(phrase).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (normalizedPhrase.length < 4) return false;
  const normalizedText = normalizeText(text).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ");
  return ` ${normalizedText} `.includes(` ${normalizedPhrase} `);
}

// 1 = phrase or every significant word present; 0.5 = at least half;
// 0 = less. Null when the concept was not asked.
function conceptScore(text = "", main = null, extraTerms = []) {
  const phrases = [main, ...(extraTerms || [])].filter(Boolean);
  if (!phrases.length) return null;
  if (phrases.some((phrase) => phraseIn(text, phrase))) return 1;

  const stems = stemSet(text);
  let best = 0;
  for (const phrase of phrases) {
    const required = significantStems(phrase);
    if (!required.length) continue;
    const found = required.filter((token) => stems.has(token)).length;
    const ratio = found / required.length;
    if (ratio === 1) best = Math.max(best, 1);
    else if (ratio >= 0.5) best = Math.max(best, 0.5);
  }
  return best;
}

function articleTitle(article = {}) {
  return String(article.title || article.library_resource?.title || "");
}

function articleAbstract(article = {}) {
  return String(article.abstract || "").slice(0, 4000);
}

// Title evidence counts fully, abstract-only evidence counts partially.
function locatedScore(article, main, terms) {
  const title = conceptScore(articleTitle(article), main, terms);
  if (title == null) return null;
  const abstract = conceptScore(articleAbstract(article), main, terms) || 0;
  return Math.max(title, abstract * 0.75);
}

// Another named musculoskeletal condition in the title, while the asked
// condition is absent from it, marks the article as being about something else.
const COMPETING_CONDITION_PATTERN =
  /\b(?:patellofemoral|osteoarthritis|tendinopathy|tendinitis|fasciitis|fasciopathy|sprain|instability|fracture|rupture|tear|impingement|capsulitis|epicondyl\w*|radiculopathy|sciatica|stenosis|spondyl\w*|whiplash|headache|migraine|scoliosis|arthroplasty|reconstruction|meniscal|meniscus|bursitis|syndrome|strain|low back pain|neck pain|shoulder pain|hip pain|knee pain)\b/;

function hasCompetingCondition(article, conditionScoreInTitle) {
  if (conditionScoreInTitle >= 0.75) return false;
  return COMPETING_CONDITION_PATTERN.test(normalizeText(articleTitle(article)));
}

// Studies and commentaries about a guideline (adherence, implementation,
// surveys, letters) are often indexed as guidelines but carry none of the
// guideline's recommendations.
const ABOUT_GUIDELINE_PATTERN =
  /\b(?:adherence|implementation|implementing|utili[sz]ation|barriers?|survey|knowledge|confidence|uptake|appropriate care|specialization|ensure quality|reinterpret\w*|comment\w*|letter|erratum|response to|re)\b/;

function isAboutGuideline(article = {}) {
  if (article.library_resource) return false;
  const title = normalizeText(articleTitle(article));
  return /guideline|guia/.test(title) && ABOUT_GUIDELINE_PATTERN.test(title);
}

function designScore(article = {}) {
  const text = normalizeText(`${article.evidence_level || ""} ${article.study_type || ""} ${articleTitle(article)}`);
  if (/protocol/.test(text)) return 0.15;
  if (isAboutGuideline(article)) return 0.3;
  const rank = Number(article.evidence_level_rank || 0);
  if (rank > 0) return Math.max(0.1, Math.min(1, rank / 10));
  if (/guideline|guia/.test(text)) return 1;
  if (/meta.?analys|systematic review/.test(text)) return 0.9;
  if (/randomi[sz]ed|rct/.test(text)) return 0.7;
  if (/cohort|prospective/.test(text)) return 0.5;
  return 0.35;
}

// Title patterns, and stricter abstract patterns: words such as
// "diagnosed", "follow-up" or "inclusion criteria" appear in almost every
// abstract and do not make a study diagnostic, prognostic or about RTS.
const QUESTION_DESIGN_PATTERNS = {
  diagnosis: {
    title: /\b(?:diagnos(?:is|tic)|accuracy|sensitivity|specificity|likelihood ratio|clinical tests?|physical exam\w*|special tests?)\b/,
    abstract: /\b(?:diagnostic (?:accuracy|test\w*|value|utility|performance)|sensitivity and specificity|likelihood ratios?|clinical tests? for)\b/,
  },
  prognosis: {
    title: /\b(?:prognos\w*|predict\w*|risk factors?|natural history|recurren\w*|course of|recovery)\b/,
    abstract: /\b(?:prognos\w*|predictors? of|risk factors? for|natural history|recurrence rate|clinical course|prospective cohort)\b/,
  },
  return_to_sport: {
    title: /\b(?:return(?:ing)? to (?:sport|play|running|competition|activity)|return-to-(?:sport|play)|rts|reinjury|re-injury)\b/,
    abstract: /\b(?:return(?:ing)? to (?:sport|play|running|competition)|return-to-(?:sport|play) criteria|reinjury rate)\b/,
  },
  progression: {
    title: /\b(?:dose|dosage|dose-response|volume|intensity|frequency|load\w*|progress\w*|parameters|prescription)\b/,
    abstract: /\b(?:dose-response|training volume|exercise dose|exercise intensity|loading (?:program|protocol)|progressi\w+ (?:of|criteria)|prescription parameters)\b/,
  },
  interpretation: {
    title: /\b(?:pain monitoring|pain-monitoring|symptom response|flare|acceptable pain|pain-guided)\b/,
    abstract: /\b(?:pain monitoring|pain-monitoring model|acceptable pain|pain-guided|symptom response)\b/,
  },
  safety: {
    title: /\b(?:adverse|safety|harms?|complications?|red flags?|contraindicat\w*|screening)\b/,
    abstract: /\b(?:adverse (?:events?|effects?)|serious complications?|red flags?|contraindicat\w*)\b/,
  },
};

// Does the study answer the kind of question asked (diagnostic accuracy for
// a diagnosis question, cohorts for prognosis...)? Null for treatment and
// general questions, where the intervention component already covers it.
function questionFitScore(article = {}, questionType = "general") {
  const patterns = QUESTION_DESIGN_PATTERNS[questionType];
  if (!patterns) return null;
  if (patterns.title.test(normalizeText(articleTitle(article)))) return 1;
  return patterns.abstract.test(normalizeText(articleAbstract(article))) ? 0.6 : 0.2;
}

function recencyScore(article = {}, nowYear = new Date().getFullYear()) {
  const year = Number(article.year || article.publication_year || 0);
  if (!year) return 0.3;
  return Math.max(0, Math.min(1, 1 - (nowYear - year) / 20));
}

const COMPARISON_LANGUAGE = /\b(?:versus|vs|compared|comparison|comparing|than|head-to-head|superior|inferior|randomi[sz]ed to|allocated to)\b/;

function directComparison(article, intent, interventionScore, comparatorScore) {
  if (!intent.comparator || !intent.intervention) return false;
  const title = articleTitle(article);
  const titleIntervention = conceptScore(title, intent.intervention, intent.intervention_terms) || 0;
  const titleComparator = conceptScore(title, intent.comparator, intent.comparator_terms) || 0;
  if (titleIntervention >= 1 && titleComparator >= 1) return true;

  // Both arms in the abstract together with comparative language.
  return (
    interventionScore >= 0.75 &&
    comparatorScore >= 0.75 &&
    COMPARISON_LANGUAGE.test(normalizeText(articleAbstract(article)))
  );
}

const MATCH_WEIGHTS = {
  condition: 0.35,
  intervention: 0.25,
  comparator: 0.15,
  population: 0.1,
  outcome: 0.05,
  question_fit: 0.1,
};

const MODE_POLICIES = {
  // Chat answers one clinical question: applicability dominates.
  chat: { match: 0.7, design: 0.22, recency: 0.08 },
  // Research is a reading list: direct match first, then quality/recency.
  research: { match: 0.55, design: 0.33, recency: 0.12 },
};

const TIER_RANK = { direct: 3, partial: 2, tangential: 1 };

function populationScore(article, intent) {
  if (article.population_match === "mismatch") return 0;
  if (!intent.population) return null;
  const score = locatedScore(article, intent.population, []);
  // An unstated population in the study is compatible, not a mismatch.
  return score >= 0.5 ? score : 0.5;
}

// Words of a normalized query that describe the request, not its topic.
const REQUEST_WORDS = new Set([
  "assessment", "evaluation", "approach", "approaches", "evidence", "effectiveness",
  "efficacy", "effective", "recommended", "recommendation", "recommendations", "intervention",
  "interventions", "physiotherapy", "physical", "rehabilitation", "options", "best", "what",
  "which", "how", "does", "diagnosis", "prognosis", "guidance", "strategies", "strategy",
]);

// When the parser found neither a condition nor an intervention (e.g. "lateral
// knee pain in a runner"), the topic words of the normalized query anchor the
// match instead, so unrelated articles cannot all score as direct.
function topicAnchor(intent = {}) {
  if (intent.condition || intent.intervention) return null;
  const words = significantStems(intent.normalized_query || "").filter(
    (token) => !REQUEST_WORDS.has(token)
  );
  return words.length ? words.join(" ") : null;
}

function scoreClinicalMatch(article = {}, intent = {}, { mode = "research" } = {}) {
  const policy = MODE_POLICIES[mode] || MODE_POLICIES.research;
  const topic = topicAnchor(intent);
  const conditionPhrase = intent.condition || topic;
  const titleCondition = conceptScore(articleTitle(article), conditionPhrase, intent.condition ? intent.condition_terms : []);
  const components = {
    condition: locatedScore(article, conditionPhrase, intent.condition ? intent.condition_terms : []),
    intervention: intent.question_type === "diagnosis" || intent.question_type === "prognosis"
      ? null
      : locatedScore(article, intent.intervention, intent.intervention_terms),
    comparator: intent.comparator
      ? locatedScore(article, intent.comparator, intent.comparator_terms)
      : null,
    population: populationScore(article, intent),
    outcome: intent.outcome ? locatedScore(article, intent.outcome, []) : null,
    question_fit: questionFitScore(article, intent.question_type),
    design: designScore(article),
    recency: recencyScore(article),
  };

  const competingCondition =
    conditionPhrase != null && hasCompetingCondition(article, titleCondition || 0);
  const isDirectComparison = directComparison(
    article,
    intent,
    components.intervention || 0,
    components.comparator || 0
  );

  const conditionOk =
    components.condition == null ? !competingCondition : components.condition >= 0.75 && !competingCondition;
  const interventionOk = components.intervention == null || components.intervention >= 0.75;
  const comparisonOk = !intent.comparator || isDirectComparison;
  const populationOk = components.population !== 0;
  // For diagnosis, prognosis, dosing or return-to-sport questions the study
  // must address that question, not only the condition.
  const questionFitOk = components.question_fit == null || components.question_fit >= 0.5;

  // The anchor is the condition (or the query topic); when neither exists,
  // the intervention, which must then appear in the title to be direct.
  const titleIntervention = conceptScore(articleTitle(article), intent.intervention, intent.intervention_terms);
  const anchorOk =
    components.condition != null
      ? conditionOk
      : !competingCondition && (components.intervention == null || components.intervention >= 0.5);
  const interventionAnchorInTitle =
    components.condition != null || components.intervention == null || (titleIntervention || 0) >= 1;

  let tier = "tangential";
  if (anchorOk && populationOk) {
    tier =
      interventionOk && comparisonOk && questionFitOk && interventionAnchorInTitle
        ? "direct"
        : "partial";
  }

  let weighted = 0;
  let weightSum = 0;
  for (const [key, weight] of Object.entries(MATCH_WEIGHTS)) {
    const value = components[key];
    if (value == null) continue;
    weighted += value * weight;
    weightSum += weight;
  }
  let matchScore = weightSum ? weighted / weightSum : 0.5;
  if (competingCondition) matchScore = Math.min(matchScore, 0.35);
  if (isDirectComparison) matchScore = Math.min(1, matchScore + 0.1);

  const rankScore =
    100 *
    (policy.match * matchScore +
      policy.design * components.design +
      policy.recency * components.recency);

  const reasons = [];
  if (components.condition != null) {
    reasons.push(
      competingCondition
        ? "title addresses a different condition"
        : components.condition >= 0.75
          ? "condition matches"
          : components.condition > 0
            ? "condition only partially matches"
            : "condition not found"
    );
  }
  if (components.intervention != null) {
    reasons.push(components.intervention >= 0.75 ? "intervention matches" : "intervention not found in title/abstract");
  }
  if (intent.comparator) {
    reasons.push(isDirectComparison ? "directly compares both options" : "does not compare both options directly");
  }
  if (components.population === 0) reasons.push("population mismatch");
  if (isAboutGuideline(article)) reasons.push("about a guideline, not the guideline itself");
  if (components.question_fit != null && components.question_fit < 0.5) {
    reasons.push(`design does not target a ${intent.question_type} question`);
  }

  return {
    version: VERSION,
    mode,
    tier,
    anchor: intent.condition ? "condition" : topic ? "query_topic" : intent.intervention ? "intervention" : "none",
    direct_comparison: isDirectComparison,
    competing_condition: competingCondition,
    components: Object.fromEntries(
      Object.entries(components).map(([key, value]) => [key, value == null ? null : Number(value.toFixed(2))])
    ),
    match_score: Number((matchScore * 100).toFixed(1)),
    rank_score: Number(rankScore.toFixed(1)),
    policy,
    reasons,
  };
}

function rankByClinicalMatch(articles = [], intent = {}, { mode = "research" } = {}) {
  return (Array.isArray(articles) ? articles : [])
    .map((article, index) => ({
      article: { ...article, clinical_match: scoreClinicalMatch(article, intent, { mode }) },
      index,
    }))
    .sort((left, right) => {
      const tierDifference =
        TIER_RANK[right.article.clinical_match.tier] - TIER_RANK[left.article.clinical_match.tier];
      if (tierDifference !== 0) return tierDifference;
      const scoreDifference = right.article.clinical_match.rank_score - left.article.clinical_match.rank_score;
      if (Math.abs(scoreDifference) > 0.05) return scoreDifference;
      return left.index - right.index;
    })
    .map(({ article }, index) => ({
      ...article,
      clinical_match: { ...article.clinical_match, position: index + 1 },
    }));
}

function summarizeClinicalMatch(articles = []) {
  const list = Array.isArray(articles) ? articles : [];
  const count = (tier) => list.filter((article) => article.clinical_match?.tier === tier).length;
  return {
    version: VERSION,
    direct: count("direct"),
    partial: count("partial"),
    tangential: count("tangential"),
    direct_comparisons: list.filter((article) => article.clinical_match?.direct_comparison).length,
  };
}

module.exports = {
  VERSION,
  isAboutGuideline,
  MODE_POLICIES,
  conceptScore,
  scoreClinicalMatch,
  rankByClinicalMatch,
  summarizeClinicalMatch,
};
