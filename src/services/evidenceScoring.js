function normalizeText(value = "") {
  return String(value || "").toLowerCase();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function containsAny(text, terms = []) {
  const normalized = normalizeText(text);
  return terms.some((term) => normalized.includes(normalizeText(term)));
}

function getArticleText(article = {}) {
  return [
    article.title,
    article.abstract,
    article.study_type,
    article.journal,
    article.condition,
    article.intervention,
    article.population,
    article.outcome,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

const PHYSIO_CORE_TERMS = [
  "physiotherapy",
  "physical therapy",
  "rehabilitation",
  "exercise therapy",
  "therapeutic exercise",
  "exercise intervention",
  "exercise programme",
  "exercise program",
  "exercise treatment",
  "exercise treatments",
  "exercise training",
  "eccentric exercise",
  "loading exercise",
  "progressive loading",
  "strength training",
  "strengthening",
  "resistance training",
  "motor control",
  "stabilization",
  "stabilisation",
  "manual therapy",
  "patient education",
  "self-management",
  "graded activity",
  "return to sport",
  "return to work",
];

const PHYSIO_PREFERRED_JOURNAL_TERMS = [
  "journal of orthopaedic and sports physical therapy",
  "journal of orthopedic and sports physical therapy",
  "journal of physiotherapy",
  "physical therapy and rehabilitation journal",
  "british journal of sports medicine",
  "clinical rehabilitation",
  "archives of physical medicine and rehabilitation",
  "physiotherapy",
  "physiotherapy theory and practice",
  "musculoskeletal science and practice",
];

const NON_PHYSIO_PRIMARY_TERMS = [
  "platelet-rich plasma",
  "platelet rich plasma",
  "prp",
  "corticosteroid",
  "injection",
  "injections",
  "shockwave therapy",
  "shock wave therapy",
  "extracorporeal shockwave",
  "extracorporeal shock wave",
  "surgery",
  "operative",
  "orthoses",
  "orthosis",
  "splinting",
  "splint",
  "laser therapy",
  "therapeutic ultrasound",
  "ultrasound therapy",
  "pharmacological",
  "pharmacologic",
];

const DIRECT_EXERCISE_TITLE_TERMS = [
  "eccentric exercise",
  "exercise therapy",
  "exercise training",
  "therapeutic exercise",
  "exercise intervention",
  "exercise interventions",
  "exercise treatment",
  "exercise treatments",
  "loading exercise",
  "strength training",
  "resistance training",
  "motor control exercise",
  "manual therapy",
  "physical therapy",
  "physiotherapy",
  "rehabilitation",
];

function hasExerciseIntent(intent = {}) {
  const text = [
    intent.intervention,
    ...(intent.search_terms || []),
  ].filter(Boolean).join(" ").toLowerCase();

  return containsAny(text, [
    "exercise",
    "eccentric",
    "strength",
    "strengthening",
    "resistance",
    "rehabilitation",
    "physical therapy",
    "physiotherapy",
    "therapeutic exercise",
    "manual therapy",
    "motor control",
    "education",
  ]);
}

function detectPhysioPrimaryFocus(article = {}) {
  const title = normalizeText(article.title);
  const abstract = normalizeText(article.abstract);
  const journal = normalizeText(article.journal);
  const studyType = normalizeText(article.study_type);

  const titleHasDirectPhysio = containsAny(title, DIRECT_EXERCISE_TITLE_TERMS);
  const journalIsPhysioPreferred = containsAny(journal, PHYSIO_PREFERRED_JOURNAL_TERMS);
  const methodsHavePhysio = containsAny(`${abstract} ${studyType}`, [
    "exercise intervention",
    "exercise therapy",
    "therapeutic exercise",
    "physical therapy",
    "physiotherapy",
    "rehabilitation",
    "randomised controlled trials concerning interventions that were based exclusively on exercise",
    "randomized controlled trials concerning interventions that were based exclusively on exercise",
    "patients received exercise",
    "rehabilitation protocol",
    "exercise protocol",
    "progressive loading",
  ]);

  return titleHasDirectPhysio || journalIsPhysioPreferred || methodsHavePhysio;
}

function detectNonPhysioPrimaryFocus(article = {}) {
  const title = normalizeText(article.title);
  const text = getArticleText(article);

  const titleHasNonPhysioFocus = containsAny(title, NON_PHYSIO_PRIMARY_TERMS);
  const titleHasDirectExerciseFocus = containsAny(title, DIRECT_EXERCISE_TITLE_TERMS);

  if (titleHasNonPhysioFocus && !titleHasDirectExerciseFocus) {
    return true;
  }

  const nonPhysioCount = NON_PHYSIO_PRIMARY_TERMS.filter((term) => text.includes(term)).length;
  const exerciseCount = DIRECT_EXERCISE_TITLE_TERMS.filter((term) => text.includes(term)).length;

  return nonPhysioCount >= 3 && exerciseCount <= 1;
}

function scorePicoMatch(article = {}, intent = {}) {
  const text = getArticleText(article);
  const title = normalizeText(article.title);
  let score = 0;
  const flags = [];
  const cautions = [];

  const condition = normalizeText(intent.condition);
  const intervention = normalizeText(intent.intervention);
  const population = normalizeText(intent.population);
  const outcome = normalizeText(intent.outcome);
  const exerciseIntent = hasExerciseIntent(intent);
  const physioPrimaryFocus = detectPhysioPrimaryFocus(article);
  const nonPhysioPrimaryFocus = exerciseIntent && detectNonPhysioPrimaryFocus(article);

  if (condition && text.includes(condition)) {
    score += 8;
    flags.push("condición coincide");
  }

  if (intervention && text.includes(intervention)) {
    score += 8;
    flags.push("intervención coincide");
  }

  if (condition && intervention && title.includes(condition) && title.includes(intervention)) {
    score += 5;
    flags.push("título responde condición e intervención");
  }

  if (exerciseIntent && physioPrimaryFocus) {
    score += 4;
    flags.push("foco principal fisioterapéutico");
  }

  if (nonPhysioPrimaryFocus) {
    score -= 10;
    cautions.push("foco principal no es fisioterapia/rehabilitación");
  }

  if (population && text.includes(population)) {
    score += 4;
    flags.push("población coincide");
  } else if (!population && containsAny(text, ["adult", "adults", "athletes", "patients"])) {
    score += 3;
    flags.push("población clínica identificable");
  }

  const outcomeTerms = [
    outcome,
    "pain",
    "disability",
    "function",
    "functional",
    "quality of life",
    "return to sport",
    "return to work",
    "visa-a",
    "odi",
    "vas",
  ].filter(Boolean);

  if (containsAny(text, outcomeTerms)) {
    score += 5;
    flags.push("outcomes clínicos relevantes");
  }

  if (containsAny(text, PHYSIO_CORE_TERMS)) {
    score += 5;
    flags.push("contexto fisioterapéutico");
  }

  return {
    score: clamp(score, 0, 30),
    flags,
    cautions,
  };
}

function scoreEvidenceHierarchy(article = {}) {
  const rank = Number(article.evidence_level_rank || 1);
  const level = article.evidence_level;

  let score = 2;

  if (level === "clinical_practice_guideline") score = 15;
  else if (level === "systematic_review_meta_analysis") score = 14;
  else if (level === "systematic_review") score = 12;
  else if (level === "randomized_controlled_trial") score = 10;
  else if (level === "cohort_study") score = 6;
  else if (level === "case_control") score = 5;
  else if (level === "cross_sectional") score = 4;
  else if (level === "case_report") score = 2;
  else if (rank <= 1) score = 1;

  return {
    score: clamp(score, 0, 15),
    flags: article.evidence_level_label_es ? [article.evidence_level_label_es] : [],
  };
}

function scoreMethodologicalQualityProxy(article = {}) {
  const text = getArticleText(article);
  let score = 0;
  const flags = [];
  const cautions = [];

  if (article.abstract) {
    score += 4;
    flags.push("resumen disponible");
  } else {
    cautions.push("metadata limitada: sin resumen");
  }

  if (containsAny(text, ["randomized controlled trial", "randomised controlled trial", "rct", "randomized", "randomised"])) {
    score += 4;
    flags.push("incluye ensayos aleatorizados");
  }

  if (containsAny(text, ["risk of bias", "rob2", "cochrane risk of bias", "methodological quality", "pedro", "delphi list"])) {
    score += 5;
    flags.push("reporta evaluación de riesgo de sesgo/calidad");
  }

  if (containsAny(text, ["grade", "certainty of evidence", "strength of evidence", "quality of evidence", "very low", "low quality", "moderate certainty", "high certainty"])) {
    score += 4;
    flags.push("reporta certeza/calidad de evidencia");
  }

  if (containsAny(text, ["prospero", "registered", "registration number", "crd420"])) {
    score += 3;
    flags.push("protocolo/registro reportado");
  }

  if (containsAny(text, ["multiple databases", "pubmed", "embase", "cochrane", "pedro", "cinahl", "web of science", "sportdiscus"])) {
    score += 3;
    flags.push("búsqueda en bases científicas");
  }

  if (containsAny(text, ["confidence interval", "95% ci", "standardized mean difference", "standardised mean difference", "mean difference", "smd", "md", "effect size"])) {
    score += 3;
    flags.push("reporta estimaciones cuantitativas");
  }

  if (containsAny(text, ["high risk of bias", "very low", "low quality evidence", "low certainty", "methodological shortcomings", "heterogeneity"])) {
    cautions.push("limitaciones metodológicas reportadas");
  }

  if (containsAny(text, ["protocol article", "study protocol", "trial protocol"])) {
    score -= 10;
    cautions.push("posible protocolo o evidencia no completada");
  }

  return {
    score: clamp(score, 0, 25),
    flags,
    cautions,
  };
}

function scorePhysiotherapyApplicability(article = {}, intent = {}) {
  const text = getArticleText(article);
  const title = normalizeText(article.title);
  const journal = normalizeText(article.journal);
  let score = 0;
  const flags = [];
  const cautions = [];
  const exerciseIntent = hasExerciseIntent(intent);
  const physioPrimaryFocus = detectPhysioPrimaryFocus(article);
  const nonPhysioPrimaryFocus = exerciseIntent && detectNonPhysioPrimaryFocus(article);

  if (physioPrimaryFocus) {
    score += 7;
    flags.push("prioridad alta para fisioterapia");
  }

  if (containsAny(title, DIRECT_EXERCISE_TITLE_TERMS)) {
    score += 5;
    flags.push("título centrado en intervención fisioterapéutica");
  }

  if (containsAny(journal, PHYSIO_PREFERRED_JOURNAL_TERMS)) {
    score += 3;
    flags.push("revista/fuente afín a fisioterapia");
  }

  if (containsAny(text, PHYSIO_CORE_TERMS)) {
    score += 4;
    flags.push("intervención aplicable en fisioterapia");
  }

  if (containsAny(text, ["pain", "disability", "function", "functional", "quality of life", "return to sport", "return to work", "visa", "odi", "vas"])) {
    score += 3;
    flags.push("outcomes clínicos útiles");
  }

  if (containsAny(text, ["dose", "dosage", "frequency", "duration", "weeks", "sessions", "progressive", "load", "loading", "protocol", "programme", "program"])) {
    score += 2;
    flags.push("aporta información de dosis/progresión");
  }

  if (containsAny(text, ["adherence", "compliance", "patient preference", "self-management", "home exercise", "supervised", "feasibility", "safety", "adverse events"])) {
    score += 2;
    flags.push("considera adherencia/seguridad/factibilidad");
  }

  if (containsAny(text, ["adult", "adults", "athlete", "athletes", "patients", "clinical", "sports professional"])) {
    score += 1;
    flags.push("población aplicable a práctica clínica");
  }

  if (nonPhysioPrimaryFocus) {
    score -= 10;
    cautions.push("evidencia complementaria: foco no fisioterapéutico");
  } else if (containsAny(text, ["injection", "surgery", "operative", "platelet-rich plasma", "corticosteroid"]) && !containsAny(text, ["exercise alone", "eccentric exercise alone", "alongside exercise", "compared with eccentric exercise"])) {
    cautions.push("foco parcial en intervención no fisioterapéutica");
  }

  return {
    score: clamp(score, 0, 20),
    flags,
    cautions,
  };
}

function scoreSourceAndRecency(article = {}) {
  let score = 0;
  const flags = [];
  const cautions = [];

  const trustedScore = Number(article.trusted_source_score || 0);
  if (trustedScore > 0) {
    score += Math.min(5, Math.ceil(trustedScore / 3));
    flags.push(`fuente preferente: ${article.trusted_source_label || "sí"}`);
  }

  const year = Number(article.year || 0);
  const nowYear = new Date().getFullYear();

  if (year) {
    const age = Math.max(0, nowYear - year);
    if (age <= 3) {
      score += 5;
      flags.push("evidencia reciente");
    } else if (age <= 7) {
      score += 3;
      flags.push("evidencia relativamente reciente");
    } else if (age <= 12) {
      score += 2;
    } else {
      score += 1;
      cautions.push("evidencia antigua; revisar si existe actualización");
    }
  } else {
    cautions.push("año no disponible");
  }

  return {
    score: clamp(score, 0, 10),
    flags,
    cautions,
  };
}

function calculateOpenPhysioEvidenceScore(article = {}, intent = {}) {
  const pico = scorePicoMatch(article, intent);
  const hierarchy = scoreEvidenceHierarchy(article);
  const quality = scoreMethodologicalQualityProxy(article);
  const applicability = scorePhysiotherapyApplicability(article, intent);
  const sourceRecency = scoreSourceAndRecency(article);

  const total = Math.round(
    pico.score +
    hierarchy.score +
    quality.score +
    applicability.score +
    sourceRecency.score
  );

  const appraisalFlags = [
    ...pico.flags,
    ...hierarchy.flags,
    ...quality.flags,
    ...applicability.flags,
    ...sourceRecency.flags,
  ];

  const cautionFlags = [
    ...pico.cautions,
    ...quality.cautions,
    ...applicability.cautions,
    ...sourceRecency.cautions,
    "estimación automática; no reemplaza lectura crítica completa",
  ];

  let priorityLabel = "Baja";
  if (total >= 85) priorityLabel = "Muy alta";
  else if (total >= 70) priorityLabel = "Alta";
  else if (total >= 55) priorityLabel = "Moderada";

  return {
    openphysio_evidence_score: clamp(total, 0, 100),
    openphysio_priority_label: priorityLabel,
    score_breakdown: {
      pico_match: pico.score,
      evidence_hierarchy: hierarchy.score,
      methodological_quality_proxy: quality.score,
      physiotherapy_applicability: applicability.score,
      source_recency: sourceRecency.score,
    },
    appraisal_flags: Array.from(new Set(appraisalFlags)).slice(0, 10),
    caution_flags: Array.from(new Set(cautionFlags)).slice(0, 8),
  };
}

module.exports = {
  calculateOpenPhysioEvidenceScore,
};
