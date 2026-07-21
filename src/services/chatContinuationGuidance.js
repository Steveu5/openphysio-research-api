function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function intentText(question = "", intent = {}) {
  return normalizeText(
    [
      question,
      intent.condition,
      intent.body_region,
      intent.normalized_query,
      intent.diagnosis,
      intent.mechanism,
      intent.activity,
      intent.symptoms,
      ...(Array.isArray(intent.search_terms) ? intent.search_terms : []),
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function articleText(articles = []) {
  return normalizeText(
    (Array.isArray(articles) ? articles : [])
      .slice(0, 4)
      .map((article) =>
        [
          article.title,
          article.study_type,
          article.evidence_level,
          article.guideline_scope_label_es,
          article.guideline_scope_label_en,
        ]
          .filter(Boolean)
          .join(" ")
      )
      .join(" ")
  );
}

function isLikelyPatellofemoralPattern(question = "", intent = {}, articles = []) {
  const text = intentText(question, intent);
  const evidence = articleText(articles);
  const combined = `${text} ${evidence}`.trim();

  const hasKneeContext =
    /\b(?:rodilla|knee|patella|patelar|rotulian|rotuliana|patellofemoral|femoropatelar)\b/.test(
      combined
    );
  if (!hasKneeContext) return false;

  if (
    /\b(?:patellofemoral|femoropatelar|femororrotulian|femororrotuliana|patellofemoral pain|dolor patelofemoral|anterior knee pain|dolor anterior de rodilla)\b/.test(
      combined
    )
  ) {
    return true;
  }

  const hasAnteriorPain =
    /\b(?:anterior|retropatelar|peripatelar|peripatellar|retropatellar|delante|frontal)\b/.test(
      text
    );
  const hasProvocation =
    /\b(?:stairs?|escaleras?|sentadilla|squat|squats|step[- ]?down|step[- ]?up|bajar|subir|correr|running|salto|jump|sitting|sedestacion)\b/.test(
      text
    );

  return hasAnteriorPain && hasProvocation;
}

function hasClinicalSpecificitySignals(question = "", intent = {}, articles = []) {
  const text = intentText(question, intent);
  const combined = `${text} ${articleText(articles)}`.trim();

  if (!text) return false;
  if (isLikelyPatellofemoralPattern(question, intent, articles)) return true;

  const diagnosticSignals = [
    "patelofemoral",
    "patellofemoral",
    "femoropatelar",
    "menisco",
    "meniscus",
    "tendinopatia",
    "tendinopathy",
    "tendinitis",
    "osteoarthritis",
    "osteoartritis",
    "artrosis",
    "acl",
    "lca",
    "ligamento cruzado",
    "ligament",
    "ligamento",
    "radiculopatia",
    "radiculopathy",
    "ciatica",
    "sciatica",
    "impingement",
    "pinzamiento",
    "capsulitis",
    "frozen shoulder",
    "inestabilidad",
    "instability",
    "fractura",
    "fracture",
    "postoperatorio",
    "postoperative",
    "postquirurgico",
    "cervicogenic",
    "cervicogenica",
    "cefalea cervicogenica",
    "whiplash",
    "latigazo",
    "esguince",
    "sprain",
  ];

  if (diagnosticSignals.some((signal) => combined.includes(signal))) return true;

  const localizationSignals = [
    "anterior",
    "posterior",
    "lateral",
    "medial",
    "retropatelar",
    "peripatelar",
    "inguinal",
    "gluteo",
    "subacromial",
    "aquiles",
    "plantar",
    "cervical alta",
    "lumbar baja",
    "orofacial",
  ];
  const provocationSignals = [
    "escalera",
    "escaleras",
    "sentadilla",
    "squat",
    "correr",
    "running",
    "saltar",
    "jump",
    "overhead",
    "por encima de la cabeza",
    "lanzar",
    "throwing",
    "caminar",
    "walking",
    "bajar",
    "subir",
    "step",
    "sedestacion",
    "sitting",
    "carga",
    "loading",
  ];
  const symptomSignals = [
    "bloqueo",
    "locking",
    "derrame",
    "swelling",
    "inflamacion",
    "instability",
    "inestabilidad",
    "chasquido",
    "clicking",
    "parestesia",
    "paresthesias",
    "hormigueo",
    "debilidad",
    "weakness",
    "irradiado",
    "radiating",
    "dolor nocturno",
  ];

  const signalCount = [
    localizationSignals.some((signal) => text.includes(signal)),
    provocationSignals.some((signal) => text.includes(signal)),
    symptomSignals.some((signal) => text.includes(signal)),
  ].filter(Boolean).length;

  return signalCount >= 2;
}

function isBroadKneeQuestion(question = "", intent = {}, articles = []) {
  const text = intentText(question, intent);
  if (!/\b(?:rodilla|knee)\b/.test(text)) return false;

  return !hasClinicalSpecificitySignals(question, intent, articles);
}

function sourceIndices(articles = []) {
  return (Array.isArray(articles) ? articles : [])
    .slice(0, 4)
    .map((_, index) => index + 1);
}

function sourceIndicesByText(articles = [], pattern) {
  return (Array.isArray(articles) ? articles : [])
    .slice(0, 4)
    .map((article, index) => ({
      index: index + 1,
      text: normalizeText(
        [article.title, article.study_type, article.evidence_level]
          .filter(Boolean)
          .join(" ")
      ),
    }))
    .filter(({ text }) => pattern.test(text))
    .map(({ index }) => index);
}

function structuredText(structured = {}) {
  const sections = [
    structured.brief_answer,
    structured.evidence_relationships,
    structured.clinical_application,
    structured.assessment_considerations,
    structured.precautions,
  ];

  return normalizeText(
    sections
      .flatMap((section) => (Array.isArray(section) ? section : []))
      .map((item) => (typeof item === "string" ? item : item?.text))
      .filter(Boolean)
      .join(" ")
  );
}

function buildPatellofemoralFollowUpOptions(language = "es") {
  const isEnglish = language === "en";

  return isEnglish
    ? [
        {
          label: "Confirm the pattern",
          prompt:
            "Which findings support patellofemoral pain rather than patellar tendinopathy, meniscal disorder, osteoarthritis, or ligament instability?",
        },
        {
          label: "Assess key impairments",
          prompt:
            "What should I assess for hip strength, dynamic control, mobility, load tolerance, and patient-reported outcomes?",
        },
        {
          label: "Progress treatment",
          prompt:
            "How can I progress education, load management, exercise, and return to stairs or squats?",
        },
      ]
    : [
        {
          label: "Confirmar el patrón",
          prompt:
            "¿Qué hallazgos apoyan dolor patelofemoral frente a tendinopatía rotuliana, lesión meniscal, artrosis o inestabilidad ligamentaria?",
        },
        {
          label: "Evaluar factores clave",
          prompt:
            "¿Qué debo evaluar en fuerza de cadera, control dinámico, movilidad, tolerancia a carga y medidas de resultado?",
        },
        {
          label: "Progresar tratamiento",
          prompt:
            "¿Cómo puedo progresar educación, manejo de carga, ejercicio y retorno a escaleras o sentadillas?",
        },
      ];
}

function buildSpecificClinicalFollowUpOptions(language = "es") {
  const isEnglish = language === "en";

  return isEnglish
    ? [
        {
          label: "Confirm applicability",
          prompt:
            "Which findings would confirm that this evidence applies to the patient's specific presentation?",
        },
        {
          label: "Check differentials",
          prompt:
            "Which differential diagnoses or warning signs should I rule out before applying this plan?",
        },
        {
          label: "Plan progression",
          prompt:
            "How can I translate this into an initial plan and decide when to progress or modify treatment?",
        },
      ]
    : [
        {
          label: "Confirmar aplicabilidad",
          prompt:
            "¿Qué hallazgos confirmarían que esta evidencia aplica al patrón clínico específico del paciente?",
        },
        {
          label: "Revisar diferenciales",
          prompt:
            "¿Qué diagnósticos diferenciales o banderas rojas debería descartar antes de aplicar este plan?",
        },
        {
          label: "Planificar progresión",
          prompt:
            "¿Cómo puedo convertir esto en un plan inicial y decidir cuándo progresar o modificar el tratamiento?",
        },
      ];
}

function buildFollowUpOptions(
  question = "",
  intent = {},
  language = "es",
  structured = {}
) {
  const text = normalizeText(
    [intentText(question, intent), structuredText(structured)]
      .filter(Boolean)
      .join(" ")
  );
  const isEnglish = language === "en";

  if (isLikelyPatellofemoralPattern(question, intent)) {
    return buildPatellofemoralFollowUpOptions(language);
  }

  if (/\b(?:rodilla|knee)\b/.test(text)) {
    return isEnglish
      ? [
          {
            label: "Differentiate the presentation",
            prompt:
              "How can I clinically differentiate patellofemoral pain, a meniscal disorder, tendinopathy, osteoarthritis, or ligament instability?",
          },
          {
            label: "Complete the assessment",
            prompt:
              "Which clinical tests and outcome measures should I use to complete this patient's assessment?",
          },
          {
            label: "Build an initial plan",
            prompt:
              "How can I organize an initial education, load-management, and exercise plan based on the findings?",
          },
        ]
      : [
          {
            label: "Diferenciar el cuadro",
            prompt:
              "¿Cómo puedo diferenciar clínicamente entre dolor patelofemoral, lesión meniscal, tendinopatía, artrosis o inestabilidad ligamentaria?",
          },
          {
            label: "Completar la evaluación",
            prompt:
              "¿Qué pruebas clínicas y medidas de resultado debería utilizar para completar la evaluación de este paciente?",
          },
          {
            label: "Construir un plan inicial",
            prompt:
              "¿Cómo puedo organizar un plan inicial de educación, manejo de carga y ejercicio según los hallazgos?",
          },
        ];
  }

  if (/lumbar|low back|lumbalgia|espalda baja/.test(text)) {
    return isEnglish
      ? [
          {
            label: "Prioritize assessment",
            prompt:
              "Which clinical findings should I prioritize to better guide this low back pain case?",
          },
          {
            label: "Choose exercise",
            prompt:
              "Which type of exercise has the best support, and how can I choose it for this patient?",
          },
          {
            label: "Dose and monitor",
            prompt:
              "How can I dose treatment and measure whether the patient is progressing?",
          },
        ]
      : [
          {
            label: "Priorizar la evaluación",
            prompt:
              "¿Qué hallazgos clínicos debería priorizar para orientar mejor este caso de dolor lumbar?",
          },
          {
            label: "Elegir el ejercicio",
            prompt:
              "¿Qué tipo de ejercicio tiene mejor respaldo y cómo puedo elegirlo según el paciente?",
          },
          {
            label: "Dosificar y medir",
            prompt:
              "¿Cómo puedo dosificar el tratamiento y medir si el paciente está progresando?",
          },
        ];
  }

  if (/cervical|neck|cefalea|headache/.test(text)) {
    return isEnglish
      ? [
          {
            label: "Differentiate the presentation",
            prompt:
              "Which clinical tests could help me differentiate the main neck pain or headache presentations?",
          },
          {
            label: "Choose treatment",
            prompt:
              "Which interventions have the best evidence, and for which patients are they most applicable?",
          },
          {
            label: "Dose and progress",
            prompt:
              "How can I safely dose and progress the exercise program?",
          },
        ]
      : [
          {
            label: "Diferenciar el cuadro",
            prompt:
              "¿Qué pruebas clínicas ayudarían a diferenciar los principales patrones de dolor cervical o cefalea?",
          },
          {
            label: "Elegir el tratamiento",
            prompt:
              "¿Qué intervenciones tienen mejor evidencia y en qué pacientes serían más aplicables?",
          },
          {
            label: "Dosificar y progresar",
            prompt:
              "¿Cómo puedo dosificar y progresar los ejercicios de forma segura?",
          },
        ];
  }

  if (hasClinicalSpecificitySignals(question, intent)) {
    return buildSpecificClinicalFollowUpOptions(language);
  }

  return isEnglish
    ? [
        {
          label: "Check applicability",
          prompt:
            "Which findings should I confirm to determine whether these recommendations apply to my patient?",
        },
        {
          label: "Build a treatment plan",
          prompt:
            "How can I translate this evidence into an initial treatment plan?",
        },
        {
          label: "Monitor progress",
          prompt:
            "Which outcome measures can I use to track progress and decide when to advance treatment?",
        },
      ]
    : [
        {
          label: "Comprobar aplicabilidad",
          prompt:
            "¿Qué hallazgos debería confirmar para saber si estas recomendaciones son aplicables a mi paciente?",
        },
        {
          label: "Construir un tratamiento",
          prompt:
            "¿Cómo puedo convertir esta evidencia en un plan inicial de tratamiento?",
        },
        {
          label: "Medir la evolución",
          prompt:
            "¿Qué medidas de resultado puedo utilizar para valorar la evolución y decidir cuándo progresar?",
        },
      ];
}

function buildBroadKneeStructure(structured = {}, articles = [], language = "es") {
  const citations = sourceIndices(articles);
  const confidence = {
    ...(structured.confidence || {}),
    level: language === "en" ? "Moderate" : "Moderado",
    level_key: "moderate",
    score: Math.min(72, Number(structured.confidence?.score || 72)),
    rationale:
      language === "en"
        ? "The query does not identify a specific knee diagnosis, and the retrieved studies address different clinical subgroups; assessment must define the presentation before applying condition-specific recommendations."
        : "La consulta no identifica un diagnóstico específico de rodilla y los estudios recuperados corresponden a subgrupos clínicos diferentes; la evaluación debe definir el cuadro antes de aplicar recomendaciones específicas.",
  };

  if (language === "en") {
    return {
      ...structured,
      brief_answer: [
        {
          text: "Knee pain is not a single diagnosis. The clinical pattern should be clarified before choosing a condition-specific treatment.",
          source_indices: [],
        },
        {
          text: "The retrieved sources address different knee pain subgroups, so their recommendations should not be automatically generalized to every patient.",
          source_indices: citations,
        },
      ],
      evidence_relationships: [
        {
          text: "The sources provide useful condition-specific evidence, but they should be used as conditional references after the assessment identifies the most likely presentation.",
          source_indices: citations,
        },
      ],
      clinical_application: [
        {
          text: "Begin with a history and physical examination focused on pain location, onset or mechanism, swelling, locking, instability, load tolerance, range of motion, strength, and the activities that are limited.",
          source_indices: [],
        },
        {
          text: "When the assessment supports a non-urgent musculoskeletal presentation, consider education, gradual load management, and exercise adapted to the findings and patient goals.",
          source_indices: citations,
        },
        {
          text: "Apply patellofemoral, osteoarthritis, tendon, meniscal, or ligament recommendations only when the clinical pattern is consistent with that condition.",
          source_indices: citations,
        },
      ],
      assessment_considerations: [
        {
          text: "Clarify whether the main problem is pain, swelling, weakness, locking, instability, or reduced confidence during loading.",
          source_indices: [],
        },
        {
          text: "Identify warning signs or a recent traumatic mechanism before starting a routine exercise progression.",
          source_indices: [],
        },
      ],
      precautions: [
        {
          text: "Do not use a guideline for one knee diagnosis as if it were directly applicable to undifferentiated knee pain.",
          source_indices: citations,
        },
        {
          text: "The treatment plan should be revised when the history or examination suggests a presentation that requires medical assessment or condition-specific management.",
          source_indices: [],
        },
      ],
      confidence,
    };
  }

  return {
    ...structured,
    brief_answer: [
      {
        text: "El dolor de rodilla no corresponde a un único diagnóstico. Antes de elegir un tratamiento específico debe definirse el patrón clínico.",
        source_indices: [],
      },
      {
        text: "Las fuentes recuperadas abordan distintos subgrupos de dolor de rodilla, por lo que sus recomendaciones no deben generalizarse automáticamente a todos los pacientes.",
        source_indices: citations,
      },
    ],
    evidence_relationships: [
      {
        text: "Las fuentes aportan evidencia útil para diagnósticos concretos, pero deben utilizarse como referencias condicionales después de que la evaluación identifique el cuadro más probable.",
        source_indices: citations,
      },
    ],
    clinical_application: [
      {
        text: "Comienza con una historia clínica y un examen físico orientados por localización del dolor, inicio o mecanismo, inflamación, bloqueo, inestabilidad, tolerancia a la carga, movilidad, fuerza y actividades limitadas.",
        source_indices: [],
      },
      {
        text: "Cuando la evaluación sea compatible con un cuadro musculoesquelético no urgente, considera educación, manejo gradual de carga y ejercicio adaptado a los hallazgos y objetivos del paciente.",
        source_indices: citations,
      },
      {
        text: "Aplica recomendaciones para dolor patelofemoral, artrosis, tendón, menisco o ligamentos solo cuando el patrón clínico sea coherente con esa condición.",
        source_indices: citations,
      },
    ],
    assessment_considerations: [
      {
        text: "Aclara si predomina dolor, inflamación, pérdida de fuerza, bloqueo, inestabilidad o inseguridad durante la carga.",
        source_indices: [],
      },
      {
        text: "Identifica señales de alarma o un mecanismo traumático reciente antes de iniciar una progresión habitual de ejercicio.",
        source_indices: [],
      },
    ],
    precautions: [
      {
        text: "No utilices una guía de un diagnóstico concreto como si fuera directamente aplicable al dolor de rodilla no diferenciado.",
        source_indices: citations,
      },
      {
        text: "El plan debe revisarse cuando la historia o el examen sugieran un cuadro que requiera valoración médica o manejo específico.",
        source_indices: [],
      },
    ],
    confidence,
  };
}

function buildPatellofemoralStructure(structured = {}, articles = [], language = "es") {
  const citations = sourceIndices(articles);
  const pfpIndices = sourceIndicesByText(
    articles,
    /patellofemoral|femoropatelar|anterior knee pain|dolor anterior/
  );
  const guidelineIndices = sourceIndicesByText(
    articles,
    /guideline|guia de practica clinica|clinical practice guideline|jospt/
  );
  const primaryIndices = pfpIndices.length ? pfpIndices : citations;
  const frameworkIndices = guidelineIndices.length ? guidelineIndices : primaryIndices;
  const currentScore = Number(structured.confidence?.score || 82);
  const score = Math.max(78, Math.min(84, currentScore || 82));
  const followUpQuestion =
    language === "en"
      ? "To refine the recommendation, which task reproduces pain most—stairs, squat, step-down, running, or sitting—and how do symptoms respond over the following 24 hours?"
      : "Para afinar la recomendación, ¿qué tarea reproduce más el dolor —escaleras, sentadilla, step-down, carrera o sedestación— y cómo responde el síntoma durante las 24 horas posteriores?";
  const confidence = {
    ...(structured.confidence || {}),
    level: language === "en" ? "Moderate-high" : "Moderado-alto",
    level_key: "moderate_high",
    score,
    rationale:
      language === "en"
        ? "Confidence is moderate-high because the symptoms suggest a patellofemoral pattern and the retrieved evidence includes condition-specific guidance, but the diagnosis still requires clinical confirmation and differential screening."
        : "La confianza es moderado-alta porque los síntomas orientan a un patrón patelofemoral y la evidencia recuperada incluye orientación específica; aun así, el diagnóstico requiere confirmación clínica y descarte de diferenciales.",
  };

  if (language === "en") {
    return {
      ...structured,
      brief_answer: [
        {
          text: "Anterior knee pain provoked by stairs or squats is compatible with a patellofemoral pain pattern, although it should be confirmed clinically and differentiated from tendon, meniscal, osteoarthritis, or ligament presentations.",
          source_indices: primaryIndices,
        },
        {
          text: "The retrieved patellofemoral evidence supports education, load management, and progressive exercise focused on functional tolerance and modifiable impairments rather than assuming one universal protocol.",
          source_indices: primaryIndices,
        },
      ],
      evidence_relationships: [
        {
          text: "The patellofemoral guideline provides the most directly related framework for this presentation; other knee sources should be interpreted according to whether the clinical pattern matches the patient.",
          source_indices: frameworkIndices,
        },
      ],
      clinical_application: [
        {
          text: "Assess pain behavior during stairs, squats, step-downs, running, sitting, or other provoking tasks, and relate symptoms to load tolerance and functional goals.",
          source_indices: primaryIndices,
        },
        {
          text: "Examine hip and knee strength, dynamic control, mobility, patellar/peripatellar symptom behavior, and patient-reported function before selecting exercises.",
          source_indices: primaryIndices,
        },
        {
          text: "Start with education, temporary load modification, and progressive strengthening or movement retraining matched to irritability and response.",
          source_indices: primaryIndices,
        },
      ],
      assessment_considerations: [
        {
          text: "Confirm that the presentation is consistent with patellofemoral pain and screen for patellar tendinopathy, meniscal symptoms, effusion, instability, osteoarthritis features, or recent trauma.",
          source_indices: primaryIndices,
        },
        {
          text: "Use functional tasks and patient-reported outcomes to monitor whether stairs, squats, or other limited activities are improving.",
          source_indices: primaryIndices,
        },
      ],
      precautions: [
        {
          text: "Do not label every anterior knee pain presentation as patellofemoral without checking differential diagnoses and irritability.",
          source_indices: primaryIndices,
        },
        {
          text: "Adjust exercise dose if symptoms flare, swelling appears, or function worsens during load progression.",
          source_indices: primaryIndices,
        },
      ],
      follow_up_question: followUpQuestion,
      confidence,
    };
  }

  return {
    ...structured,
    brief_answer: [
      {
        text: "El dolor anterior de rodilla provocado por escaleras o sentadillas es compatible con un patrón de dolor patelofemoral, aunque debe confirmarse clínicamente y diferenciarse de tendón, menisco, artrosis o inestabilidad ligamentaria.",
        source_indices: primaryIndices,
      },
      {
        text: "La evidencia patelofemoral recuperada respalda educación, manejo de carga y ejercicio progresivo centrado en tolerancia funcional e impedimentos modificables, sin asumir un protocolo universal.",
        source_indices: primaryIndices,
      },
    ],
    evidence_relationships: [
      {
        text: "La guía patelofemoral aporta el marco más directamente relacionado con este patrón; otras fuentes de rodilla deben interpretarse según si el cuadro clínico coincide con el paciente.",
        source_indices: frameworkIndices,
      },
    ],
    clinical_application: [
      {
        text: "Evalúa el comportamiento del dolor durante escaleras, sentadillas, step-down, carrera, sedestación u otras tareas provocadoras, relacionándolo con tolerancia a la carga y objetivos funcionales.",
        source_indices: primaryIndices,
      },
      {
        text: "Explora fuerza de cadera y rodilla, control dinámico, movilidad, comportamiento patelar o peripatelar y función reportada por el paciente antes de elegir ejercicios.",
        source_indices: primaryIndices,
      },
      {
        text: "Inicia con educación, modificación temporal de carga y fortalecimiento progresivo o reentrenamiento del movimiento ajustado a irritabilidad y respuesta.",
        source_indices: primaryIndices,
      },
    ],
    assessment_considerations: [
      {
        text: "Confirma que el patrón sea compatible con dolor patelofemoral y descarta tendinopatía rotuliana, síntomas meniscales, derrame, inestabilidad, rasgos de artrosis o trauma reciente.",
        source_indices: primaryIndices,
      },
      {
        text: "Usa tareas funcionales y medidas reportadas por el paciente para monitorear si escaleras, sentadillas u otras actividades limitadas están mejorando.",
        source_indices: primaryIndices,
      },
    ],
    precautions: [
      {
        text: "No etiquetes todo dolor anterior de rodilla como patelofemoral sin revisar diagnósticos diferenciales e irritabilidad.",
        source_indices: primaryIndices,
      },
      {
        text: "Ajusta la dosis de ejercicio si los síntomas aumentan, aparece inflamación o empeora la función durante la progresión de carga.",
        source_indices: primaryIndices,
      },
    ],
    follow_up_question: followUpQuestion,
    confidence,
  };
}

function applyChatContinuationGuidance({
  structured = {},
  question = "",
  intent = {},
  articles = [],
  language = "es",
}) {
  const scoped = isLikelyPatellofemoralPattern(question, intent, articles)
    ? buildPatellofemoralStructure(structured, articles, language)
    : isBroadKneeQuestion(question, intent, articles)
      ? buildBroadKneeStructure(structured, articles, language)
      : structured;

  return {
    ...scoped,
    follow_up_options: buildFollowUpOptions(question, intent, language, scoped),
  };
}

module.exports = {
  isBroadKneeQuestion,
  isLikelyPatellofemoralPattern,
  hasClinicalSpecificitySignals,
  buildFollowUpOptions,
  buildSpecificClinicalFollowUpOptions,
  buildPatellofemoralStructure,
  buildBroadKneeStructure,
  applyChatContinuationGuidance,
};