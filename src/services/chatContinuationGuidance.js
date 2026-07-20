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
      ...(Array.isArray(intent.search_terms) ? intent.search_terms : []),
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function isBroadKneeQuestion(question = "", intent = {}) {
  const text = intentText(question, intent);
  if (!/\b(?:rodilla|knee)\b/.test(text)) return false;

  const specificSignals = [
    "patelofemoral",
    "femoropatelar",
    "patellar tendon",
    "tendinopatia rotuliana",
    "tendinitis rotuliana",
    "osteoarthritis",
    "osteoartritis",
    "artrosis",
    "meniscus",
    "menisco",
    "acl",
    "lca",
    "ligamento cruzado",
    "collateral ligament",
    "ligamento colateral",
    "fracture",
    "fractura",
    "postoperative",
    "posoperatorio",
    "postquirurgico",
  ];

  return !specificSignals.some((signal) => text.includes(signal));
}

function sourceIndices(articles = []) {
  return (Array.isArray(articles) ? articles : [])
    .slice(0, 4)
    .map((_, index) => index + 1);
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

function applyChatContinuationGuidance({
  structured = {},
  question = "",
  intent = {},
  articles = [],
  language = "es",
}) {
  const scoped = isBroadKneeQuestion(question, intent)
    ? buildBroadKneeStructure(structured, articles, language)
    : structured;

  return {
    ...scoped,
    follow_up_options: buildFollowUpOptions(question, intent, language, scoped),
  };
}

module.exports = {
  isBroadKneeQuestion,
  buildFollowUpOptions,
  buildBroadKneeStructure,
  applyChatContinuationGuidance,
};
