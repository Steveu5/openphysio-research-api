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

function buildFollowUpOptions(question = "", intent = {}, language = "es") {
  const text = intentText(question, intent);
  const isEnglish = language === "en";

  if (/\b(?:rodilla|knee)\b/.test(text)) {
    return isEnglish
      ? [
          {
            label: "Pain and location",
            prompt:
              "Pain is the main problem. It is located at ___ and is most noticeable during ___.",
          },
          {
            label: "Swelling or locking",
            prompt:
              "There is swelling, locking, catching, or clicking. What I notice is ___.",
          },
          {
            label: "Strength limitation",
            prompt:
              "The main limitation is loss of strength during ___.",
          },
          {
            label: "Instability with loading",
            prompt:
              "The patient feels instability or lack of confidence during ___.",
          },
        ]
      : [
          {
            label: "Dolor y localización",
            prompt:
              "El principal problema es el dolor. Se localiza en ___ y aparece sobre todo durante ___.",
          },
          {
            label: "Inflamación o bloqueo",
            prompt:
              "Hay inflamación, derrame, bloqueo, chasquidos o sensación de atrapamiento. Lo que observo es ___.",
          },
          {
            label: "Pérdida de fuerza",
            prompt:
              "La principal limitación es la pérdida de fuerza durante ___.",
          },
          {
            label: "Inseguridad al cargar",
            prompt:
              "El paciente siente inestabilidad o inseguridad durante ___.",
          },
        ];
  }

  if (/lumbar|low back|lumbalgia|espalda baja/.test(text)) {
    return isEnglish
      ? [
          {
            label: "Pain is the main limit",
            prompt:
              "Pain is the main limitation. It increases during ___ and improves with ___.",
          },
          {
            label: "Low activity tolerance",
            prompt:
              "The main problem is low activity tolerance, especially during ___.",
          },
          {
            label: "Sleep is affected",
            prompt:
              "Sleep is affected because ___, and the symptoms are worse at ___.",
          },
          {
            label: "Exercises already tried",
            prompt:
              "The patient has already tried these exercises or treatments: ___. The response was ___.",
          },
        ]
      : [
          {
            label: "Predomina el dolor",
            prompt:
              "El dolor es la principal limitación. Aumenta durante ___ y mejora con ___.",
          },
          {
            label: "Baja tolerancia a actividad",
            prompt:
              "El principal problema es la baja tolerancia a la actividad, especialmente durante ___.",
          },
          {
            label: "Sueño afectado",
            prompt:
              "El sueño está afectado porque ___ y los síntomas empeoran a ___.",
          },
          {
            label: "Ejercicios ya probados",
            prompt:
              "El paciente ya probó estos ejercicios o tratamientos: ___. La respuesta fue ___.",
          },
        ];
  }

  if (/cervical|neck|cefalea|headache/.test(text)) {
    return isEnglish
      ? [
          {
            label: "Neck pain predominates",
            prompt:
              "Neck pain is the main problem and is aggravated by ___.",
          },
          {
            label: "Headache predominates",
            prompt:
              "Headache is the main problem. Its frequency, duration, and triggers are ___.",
          },
          {
            label: "Functional limitation",
            prompt:
              "The main functional limitation is ___, especially during ___.",
          },
          {
            label: "Previous treatment",
            prompt:
              "The interventions already tried were ___. The response was ___.",
          },
        ]
      : [
          {
            label: "Predomina dolor cervical",
            prompt:
              "El dolor cervical es el principal problema y aumenta durante ___.",
          },
          {
            label: "Predomina cefalea",
            prompt:
              "La cefalea es el principal problema. Su frecuencia, duración y desencadenantes son ___.",
          },
          {
            label: "Limitación funcional",
            prompt:
              "La principal limitación funcional es ___, especialmente durante ___.",
          },
          {
            label: "Tratamientos previos",
            prompt:
              "Las intervenciones ya probadas fueron ___. La respuesta fue ___.",
          },
        ];
  }

  return isEnglish
    ? [
        {
          label: "Main limitation",
          prompt: "The patient's main functional limitation is ___.",
        },
        {
          label: "Most difficult activity",
          prompt: "The activity that is most difficult is ___ because ___.",
        },
        {
          label: "Previous treatment",
          prompt: "The treatments or exercises already tried were ___.",
        },
        {
          label: "Patient goal",
          prompt: "The patient's main goal is to return to ___.",
        },
      ]
    : [
        {
          label: "Principal limitación",
          prompt: "La principal limitación funcional del paciente es ___.",
        },
        {
          label: "Actividad más difícil",
          prompt: "La actividad más difícil es ___ porque ___.",
        },
        {
          label: "Tratamientos previos",
          prompt: "Los tratamientos o ejercicios ya probados fueron ___.",
        },
        {
          label: "Objetivo del paciente",
          prompt: "El principal objetivo del paciente es volver a ___.",
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
    follow_up_options: buildFollowUpOptions(question, intent, language),
  };
}

module.exports = {
  isBroadKneeQuestion,
  buildFollowUpOptions,
  buildBroadKneeStructure,
  applyChatContinuationGuidance,
};
