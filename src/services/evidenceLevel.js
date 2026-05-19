const EVIDENCE_LEVELS = {
  clinical_practice_guideline: {
    rank: 10,
    label_es: "Guía de práctica clínica",
    label_en: "Clinical practice guideline",
  },
  systematic_review_meta_analysis: {
    rank: 9,
    label_es: "Revisión sistemática y metaanálisis",
    label_en: "Systematic review and meta-analysis",
  },
  systematic_review: {
    rank: 8,
    label_es: "Revisión sistemática",
    label_en: "Systematic review",
  },
  randomized_controlled_trial: {
    rank: 7,
    label_es: "Ensayo clínico aleatorizado",
    label_en: "Randomized controlled trial",
  },
  cohort_study: {
    rank: 5,
    label_es: "Estudio de cohorte",
    label_en: "Cohort study",
  },
  case_control: {
    rank: 4,
    label_es: "Caso-control",
    label_en: "Case-control study",
  },
  cross_sectional: {
    rank: 3,
    label_es: "Transversal",
    label_en: "Cross-sectional study",
  },
  case_report: {
    rank: 2,
    label_es: "Reporte de caso",
    label_en: "Case report",
  },
  expert_opinion: {
    rank: 1,
    label_es: "Opinión de experto",
    label_en: "Expert opinion",
  },
  preprint_or_unclear: {
    rank: 1,
    label_es: "Preprint o no claro",
    label_en: "Preprint or unclear",
  },
};

const PHYSIO_TERMS = [
  "physiotherapy",
  "physical therapy",
  "physical therapist",
  "rehabilitation",
  "exercise therapy",
  "therapeutic exercise",
  "exercise intervention",
  "motor control",
  "stabilization",
  "stabilisation",
  "core stability",
  "strengthening",
  "strength training",
  "resistance training",
  "manual therapy",
  "education",
  "self-management",
  "return to function",
  "functional disability",
  "disability",
  "pain",
  "musculoskeletal",
  "neurological rehabilitation",
  "neurorehabilitation",
  "cardiorespiratory rehabilitation",
  "sports rehabilitation",
  "sports physiotherapy",
  "load management",
  "graded activity",
  "graded exercise",
  "therapeutic alliance",
  "patient education",
];

function toLower(value) {
  return String(value || "").toLowerCase();
}

function getSearchableText(article = {}) {
  return [
    article.title,
    article.abstract,
    article.study_type,
    article.journal,
    article.authors_text,
    article.condition,
    article.intervention,
    article.population,
    article.outcome,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isProtocolArticle(article = {}) {
  const title = toLower(article.title);
  const studyType = toLower(article.study_type);
  const abstract = toLower(article.abstract);

  const titleOrTypeLooksLikeProtocol = [
    "study protocol",
    "protocol for",
    "trial protocol",
    "protocol of",
    "protocol paper",
    "registered protocol",
  ].some((term) => title.includes(term) || studyType.includes(term));

  if (titleOrTypeLooksLikeProtocol) return true;

  // Do not classify a completed review as a protocol just because the abstract
  // mentions PROSPERO, exercise protocol, treatment protocol, or registration.
  const completedReviewSignals =
    title.includes("systematic review") ||
    title.includes("meta-analysis") ||
    title.includes("meta analysis") ||
    studyType.includes("systematic review") ||
    studyType.includes("meta-analysis") ||
    studyType.includes("meta analysis") ||
    abstract.includes("we included") ||
    abstract.includes("were included") ||
    abstract.includes("meta-analysis was performed") ||
    abstract.includes("systematic review and meta-analysis") ||
    abstract.includes("this meta-analysis") ||
    abstract.includes("this systematic review");

  if (completedReviewSignals) return false;

  return (
    title === "protocol" ||
    title.endsWith(" protocol") ||
    studyType === "protocol" ||
    studyType.includes("protocol article") ||
    abstract.includes("this protocol describes") ||
    abstract.includes("the protocol describes") ||
    abstract.includes("we describe the protocol") ||
    abstract.includes("aim of this protocol") ||
    abstract.includes("protocol has been registered")
  );
}

function isGuidelineReviewOrOverview(article = {}) {
  const title = toLower(article.title);
  const studyType = toLower(article.study_type);
  const abstract = toLower(article.abstract);
  const combined = `${title} ${studyType} ${abstract}`;

  const mentionsGuidelines =
    combined.includes("clinical practice guideline") ||
    combined.includes("clinical practice guidelines") ||
    combined.includes("practice guidelines") ||
    combined.includes("cpgs") ||
    combined.includes("guideline recommendations");

  const isReviewLike =
    title.includes("systematic review") ||
    studyType.includes("systematic review") ||
    title.includes("overview") ||
    studyType.includes("overview") ||
    title.includes("global comparison") ||
    title.includes("comparison of") ||
    abstract.includes("systematic review") ||
    abstract.includes("narrative synthesis") ||
    abstract.includes("critical appraisal") ||
    abstract.includes("identify and compare") ||
    abstract.includes("appraised") ||
    abstract.includes("included cpgs") ||
    abstract.includes("guidelines were searched") ||
    abstract.includes("we identified") && abstract.includes("guidelines");

  return mentionsGuidelines && isReviewLike;
}

function calculateEvidenceLevel(article = {}) {
  const title = toLower(article.title);
  const studyType = toLower(article.study_type);
  const abstract = toLower(article.abstract);
  const text = `${title} ${studyType} ${abstract}`;

  let key = "preprint_or_unclear";

  if (isProtocolArticle(article)) {
    return {
      evidence_level: "preprint_or_unclear",
      evidence_level_label_es: "Protocolo o evidencia no completada",
      evidence_level_label_en: "Protocol or incomplete evidence",
      evidence_level_rank: 1,
    };
  }

  // A systematic review, overview, or comparison of clinical practice guidelines
  // is not itself a clinical practice guideline. Classify it as a review first.
  if (isGuidelineReviewOrOverview(article)) {
    if (text.includes("meta-analysis") || text.includes("meta analysis")) {
      key = "systematic_review_meta_analysis";
    } else {
      key = "systematic_review";
    }
  } else if (
    title.includes("clinical practice guideline") ||
    title.includes("practice guideline") ||
    studyType.includes("clinical practice guideline") ||
    studyType === "guideline" ||
    studyType.includes("guideline")
  ) {
    key = "clinical_practice_guideline";
  } else if (
    (text.includes("systematic review") && (text.includes("meta-analysis") || text.includes("meta analysis"))) ||
    studyType.includes("systematic review and meta")
  ) {
    key = "systematic_review_meta_analysis";
  } else if (text.includes("meta-analysis") || text.includes("meta analysis")) {
    key = "systematic_review_meta_analysis";
  } else if (text.includes("systematic review")) {
    key = "systematic_review";
  } else if (
    title.includes("randomized controlled trial") ||
    title.includes("randomised controlled trial") ||
    title.includes("randomized trial") ||
    title.includes("randomised trial") ||
    title.includes("placebo-controlled trial") ||
    studyType.includes("randomized controlled trial") ||
    studyType.includes("randomised controlled trial") ||
    studyType.includes("randomized trial") ||
    studyType.includes("randomised trial") ||
    studyType.includes("controlled trial") ||
    /\brct\b/.test(studyType)
  ) {
    key = "randomized_controlled_trial";
  } else if (text.includes("cohort")) {
    key = "cohort_study";
  } else if (text.includes("case-control") || text.includes("case control")) {
    key = "case_control";
  } else if (text.includes("cross-sectional") || text.includes("cross sectional")) {
    key = "cross_sectional";
  } else if (text.includes("case report") || text.includes("case series")) {
    key = "case_report";
  } else if (
    text.includes("expert opinion") ||
    text.includes("narrative review") ||
    text.includes("commentary") ||
    studyType === "review" ||
    title.includes("review")
  ) {
    key = "expert_opinion";
  }

  const level = EVIDENCE_LEVELS[key];

  return {
    evidence_level: key,
    evidence_level_label_es: level.label_es,
    evidence_level_label_en: level.label_en,
    evidence_level_rank: level.rank,
  };
}

function calculatePhysiotherapyRelevance(article = {}, intent = {}) {
  const text = getSearchableText(article);
  const matchedTerms = PHYSIO_TERMS.filter((term) => text.includes(term));
  let score = Math.min(20, matchedTerms.length * 4);

  const intervention = toLower(intent.intervention);
  const searchTerms = (intent.search_terms || []).map(toLower).join(" ");
  const intentText = `${intervention} ${searchTerms}`;

  if (
    intentText.includes("exercise") ||
    intentText.includes("physiotherapy") ||
    intentText.includes("physical therapy") ||
    intentText.includes("rehabilitation")
  ) {
    score += 8;
  }

  const highValueStudy = calculateEvidenceLevel(article).evidence_level_rank >= 8;
  const conditionMatch = intent.condition && text.includes(toLower(intent.condition));
  const interventionMatch = intent.intervention && text.includes(toLower(intent.intervention));

  if (highValueStudy && (conditionMatch || interventionMatch)) {
    score += 6;
  }

  return {
    physiotherapy_relevance_score: Math.min(30, score),
    physiotherapy_terms: matchedTerms.slice(0, 8),
    is_physiotherapy_relevant: score >= 8 || Boolean(conditionMatch && interventionMatch),
  };
}

function shouldKeepForPhysiotherapySearch(article = {}, intent = {}) {
  const text = getSearchableText(article);
  const physiotherapy = calculatePhysiotherapyRelevance(article, intent);
  const evidence = calculateEvidenceLevel(article);

  const conditionMatch = intent.condition && text.includes(toLower(intent.condition));
  const interventionMatch = intent.intervention && text.includes(toLower(intent.intervention));

  if (conditionMatch && interventionMatch) return true;
  if (physiotherapy.is_physiotherapy_relevant && (conditionMatch || interventionMatch)) return true;
  if (evidence.evidence_level_rank >= 8 && (conditionMatch || interventionMatch)) return true;

  return physiotherapy.is_physiotherapy_relevant;
}

function enrichEvidenceMetadata(article = {}, intent = {}) {
  return {
    ...article,
    ...calculateEvidenceLevel(article),
    ...calculatePhysiotherapyRelevance(article, intent),
  };
}

module.exports = {
  calculateEvidenceLevel,
  calculatePhysiotherapyRelevance,
  shouldKeepForPhysiotherapySearch,
  enrichEvidenceMetadata,
  PHYSIO_TERMS,
};
