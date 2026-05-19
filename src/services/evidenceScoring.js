const { calculatePedroQualityBoost } = require("./pedroScore");

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

const INTERVENTION_SYNONYM_GROUPS = {
  exercise: [
    "exercise",
    "exercise therapy",
    "therapeutic exercise",
    "exercise treatment",
    "exercise treatments",
    "exercise training",
    "exercise intervention",
    "exercise interventions",
    "exercise programme",
    "exercise program",
    "physical activity",
    "graded activity",
    "pilates",
    "yoga",
    "motor control",
    "stabilization",
    "stabilisation",
    "strengthening",
    "strength training",
    "resistance training",
    "loading exercise",
    "progressive loading",
  ],
  manual_therapy: [
    "manual therapy",
    "mobilization",
    "mobilisation",
    "manipulation",
    "spinal manipulation",
  ],
  education: [
    "education",
    "patient education",
    "pain education",
    "pain neurophysiology education",
    "self-management",
    "advice",
  ],
};

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

const DIRECT_PHYSIO_TITLE_TERMS = [
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

  return containsAny(text, INTERVENTION_SYNONYM_GROUPS.exercise);
}

function getInterventionSynonyms(intent = {}) {
  const interventionText = [
    intent.intervention,
    ...(intent.search_terms || []),
  ].filter(Boolean).join(" ").toLowerCase();

  const terms = new Set();
  if (containsAny(interventionText, INTERVENTION_SYNONYM_GROUPS.exercise)) {
    INTERVENTION_SYNONYM_GROUPS.exercise.forEach((term) => terms.add(term));
  }
  if (containsAny(interventionText, INTERVENTION_SYNONYM_GROUPS.manual_therapy)) {
    INTERVENTION_SYNONYM_GROUPS.manual_therapy.forEach((term) => terms.add(term));
  }
  if (containsAny(interventionText, INTERVENTION_SYNONYM_GROUPS.education)) {
    INTERVENTION_SYNONYM_GROUPS.education.forEach((term) => terms.add(term));
  }

  if (intent.intervention) terms.add(normalizeText(intent.intervention));
  return Array.from(terms).filter(Boolean);
}

function detectPhysioPrimaryFocus(article = {}) {
  const title = normalizeText(article.title);
  const abstract = normalizeText(article.abstract);
  const journal = normalizeText(article.journal);
  const studyType = normalizeText(article.study_type);

  const titleHasDirectPhysio = containsAny(title, DIRECT_PHYSIO_TITLE_TERMS);
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
  const titleHasDirectPhysioFocus = containsAny(title, DIRECT_PHYSIO_TITLE_TERMS);

  if (titleHasNonPhysioFocus && !titleHasDirectPhysioFocus) return true;

  const nonPhysioCount = NON_PHYSIO_PRIMARY_TERMS.filter((term) => text.includes(term)).length;
  const physioCount = DIRECT_PHYSIO_TITLE_TERMS.filter((term) => text.includes(term)).length;

  return nonPhysioCount >= 3 && physioCount <= 1;
}

function scoreEvidenceHierarchy(article = {}) {
  const rank = Number(article.evidence_level_rank || 1);
  const level = article.evidence_level;

  let score = 2;

  if (level === "clinical_practice_guideline") score = 20;
  else if (level === "systematic_review_meta_analysis") score = 19;
  else if (level === "systematic_review") score = 17;
  else if (level === "randomized_controlled_trial") score = 14;
  else if (level === "cohort_study") score = 8;
  else if (level === "case_control") score = 6;
  else if (level === "cross_sectional") score = 5;
  else if (level === "case_report") score = 3;
  else if (rank <= 1) score = 1;

  return {
    score: clamp(score, 0, 20),
    flags: article.evidence_level_label_es ? [article.evidence_level_label_es] : [],
  };
}

function scoreMethodologicalQualityProxy(article = {}) {
  const text = getArticleText(article);
  const pedro = calculatePedroQualityBoost(article);
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

  if (pedro.pedro_quality_boost !== 0) {
    score += pedro.pedro_quality_boost;
    flags.push(`PEDro score: ${pedro.pedro_score}/10 (${pedro.pedro_score_label})`);
  } else if (pedro.pedro_score_status === "not_found_yet") {
    cautions.push("PEDro score no confirmado todavía");
  }

  if (containsAny(text, ["risk of bias", "rob2", "cochrane risk of bias", "methodological quality", "pedro", "delphi list", "agree ii", "amstar"])) {
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
    pedro,
  };
}

function scorePhysiotherapyFocus(article = {}) {
  const text = getArticleText(article);
  const title = normalizeText(article.title);
  const journal = normalizeText(article.journal);
  let score = 0;
  const flags = [];
  const cautions = [];

  const physioPrimaryFocus = detectPhysioPrimaryFocus(article);
  const nonPhysioPrimaryFocus = detectNonPhysioPrimaryFocus(article);

  if (physioPrimaryFocus) {
    score += 8;
    flags.push("foco principal fisioterapéutico");
  }

  if (containsAny(title, DIRECT_PHYSIO_TITLE_TERMS)) {
    score += 5;
    flags.push("título centrado en intervención fisioterapéutica");
  }

  if (containsAny(journal, PHYSIO_PREFERRED_JOURNAL_TERMS)) {
    score += 4;
    flags.push("revista/fuente afín a fisioterapia");
  }

  if (containsAny(text, PHYSIO_CORE_TERMS)) {
    score += 5;
    flags.push("intervención aplicable en fisioterapia");
  }

  if (nonPhysioPrimaryFocus) {
    score -= 8;
    cautions.push("foco principal no fisioterapéutico");
  }

  return {
    score: clamp(score, 0, 20),
    flags,
    cautions,
  };
}

function scoreClinicalUsefulness(article = {}) {
  const text = getArticleText(article);
  let score = 0;
  const flags = [];
  const cautions = [];

  if (containsAny(text, ["pain", "disability", "function", "functional", "quality of life", "return to sport", "return to work", "visa", "odi", "vas", "roland-morris", "oswestry"])) {
    score += 5;
    flags.push("outcomes clínicos útiles");
  }

  if (containsAny(text, ["dose", "dosage", "frequency", "duration", "weeks", "sessions", "progressive", "load", "loading", "protocol", "programme", "program"])) {
    score += 4;
    flags.push("aporta información de dosis/progresión");
  }

  if (containsAny(text, ["adherence", "compliance", "patient preference", "self-management", "home exercise", "supervised", "feasibility", "safety", "adverse events"])) {
    score += 4;
    flags.push("considera adherencia/seguridad/factibilidad");
  }

  if (containsAny(text, ["adult", "adults", "athlete", "athletes", "patients", "clinical", "sports professional"])) {
    score += 3;
    flags.push("población clínica identificable");
  }

  if (containsAny(text, ["injection", "surgery", "operative", "platelet-rich plasma", "corticosteroid", "pharmacological", "pharmacologic"])) {
    cautions.push("puede tener foco médico complementario");
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
    score += Math.min(7, Math.ceil(trustedScore / 2.5));
    flags.push(`fuente preferente: ${article.trusted_source_label || "sí"}`);
  }

  const year = Number(article.year || 0);
  const nowYear = new Date().getFullYear();

  if (year) {
    const age = Math.max(0, nowYear - year);
    if (age <= 3) {
      score += 8;
      flags.push("evidencia reciente");
    } else if (age <= 7) {
      score += 5;
      flags.push("evidencia relativamente reciente");
    } else if (age <= 12) {
      score += 3;
    } else {
      score += 1;
      cautions.push("evidencia antigua; revisar si existe actualización");
    }
  } else {
    cautions.push("año no disponible");
  }

  return {
    score: clamp(score, 0, 15),
    flags,
    cautions,
  };
}

function calculateOpenPhysioEvidenceScore(article = {}) {
  const hierarchy = scoreEvidenceHierarchy(article);
  const quality = scoreMethodologicalQualityProxy(article);
  const physiotherapyFocus = scorePhysiotherapyFocus(article);
  const clinicalUsefulness = scoreClinicalUsefulness(article);
  const sourceRecency = scoreSourceAndRecency(article);
  const pedro = quality.pedro;

  const total = Math.round(
    hierarchy.score +
    quality.score +
    physiotherapyFocus.score +
    clinicalUsefulness.score +
    sourceRecency.score
  );

  const appraisalFlags = [
    ...hierarchy.flags,
    ...quality.flags,
    ...physiotherapyFocus.flags,
    ...clinicalUsefulness.flags,
    ...sourceRecency.flags,
  ];

  const cautionFlags = [
    ...quality.cautions,
    ...physiotherapyFocus.cautions,
    ...clinicalUsefulness.cautions,
    ...sourceRecency.cautions,
    "calificación intrínseca del artículo; no depende de la pregunta del usuario",
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
      evidence_hierarchy: hierarchy.score,
      methodological_quality_proxy: quality.score,
      physiotherapy_applicability: physiotherapyFocus.score,
      clinical_usefulness: clinicalUsefulness.score,
      source_recency: sourceRecency.score,
      // Backward-compatible key for the current frontend. It is no longer PICO/query-dependent.
      pico_match: clinicalUsefulness.score,
    },
    appraisal_flags: Array.from(new Set(appraisalFlags)).slice(0, 10),
    caution_flags: Array.from(new Set(cautionFlags)).slice(0, 8),
    pedro_score: pedro.pedro_score,
    pedro_score_label: pedro.pedro_score_label,
    pedro_score_status: pedro.pedro_score_status,
    pedro_applicability: pedro.pedro_applicability,
    pedro_quality_boost: pedro.pedro_quality_boost,
    pedro_explanation: pedro.pedro_explanation,
  };
}

function calculateQueryRelevanceScore(article = {}, intent = {}) {
  const text = getArticleText(article);
  const title = normalizeText(article.title);
  const condition = normalizeText(intent.condition);
  const population = normalizeText(intent.population);
  const outcome = normalizeText(intent.outcome);
  const exerciseIntent = hasExerciseIntent(intent);
  const interventionSynonyms = getInterventionSynonyms(intent);

  let score = 0;
  const flags = [];
  const limitations = [];

  if (condition && text.includes(condition)) {
    score += 25;
    flags.push("coincide con la condición consultada");
  }

  const hasInterventionMatch = interventionSynonyms.length
    ? containsAny(text, interventionSynonyms)
    : false;

  const hasInterventionTitleMatch = interventionSynonyms.length
    ? containsAny(title, interventionSynonyms)
    : false;

  if (hasInterventionMatch) {
    score += 25;
    flags.push("coincide con la intervención consultada o sus sinónimos");
  }

  if (condition && hasInterventionTitleMatch && title.includes(condition)) {
    score += 20;
    flags.push("el título responde directamente la pregunta");
  }

  if (population && text.includes(population)) {
    score += 8;
    flags.push("coincide con la población");
  } else if (population) {
    limitations.push("población no coincide claramente con la pregunta");
  }

  if (outcome && text.includes(outcome)) {
    score += 7;
    flags.push("coincide con el outcome consultado");
  } else if (containsAny(text, ["pain", "disability", "function", "quality of life", "return to sport", "return to work"])) {
    score += 5;
    flags.push("incluye outcomes clínicos relacionados");
  }

  if (exerciseIntent && detectPhysioPrimaryFocus(article)) {
    score += 10;
    flags.push("foco compatible con fisioterapia/rehabilitación");
  }

  if (exerciseIntent && detectNonPhysioPrimaryFocus(article)) {
    score -= 18;
    limitations.push("foco principal menos directo para una pregunta de ejercicio/rehabilitación");
  }

  if (!article.abstract) {
    score -= 10;
    limitations.push("metadata limitada: sin resumen");
  }

  return {
    query_relevance_score: clamp(Math.round(score), 0, 100),
    query_relevance_flags: Array.from(new Set(flags)).slice(0, 8),
    query_relevance_limitations: Array.from(new Set(limitations)).slice(0, 8),
  };
}

module.exports = {
  calculateOpenPhysioEvidenceScore,
  calculateQueryRelevanceScore,
  detectPhysioPrimaryFocus,
  detectNonPhysioPrimaryFocus,
};
