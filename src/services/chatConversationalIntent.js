const PHRASES = [
  {
    type: "greeting",
    language: "es",
    values: [
      "hola",
      "ola",
      "holi",
      "holaa",
      "hola buenas",
      "hola buen dia",
      "hola buenos dias",
      "hola buenas tardes",
      "hola buenas noches",
      "hola chat",
      "hola openphysio",
      "hola openphysioai",
      "buenas",
      "buen dia",
      "buenos dias",
      "muy buenos dias",
      "buenas tardes",
      "buenas noches",
      "muy buenas",
      "saludos",
      "hola como estas",
      "hola que tal",
      "hola todo bien",
      "buenas como estas",
      "como estas",
      "como te va",
      "que tal",
      "todo bien",
    ],
  },
  {
    type: "greeting",
    language: "en",
    values: [
      "hello",
      "hi",
      "hey",
      "good morning",
      "good afternoon",
      "good evening",
      "hello how are you",
      "hi how are you",
      "hey how are you",
      "how are you",
      "how is it going",
    ],
  },
  {
    type: "thanks",
    language: "es",
    values: [
      "gracias",
      "muchas gracias",
      "mil gracias",
      "gracias por tu ayuda",
      "te lo agradezco",
      "perfecto gracias",
    ],
  },
  {
    type: "thanks",
    language: "en",
    values: [
      "thanks",
      "thank you",
      "thanks a lot",
      "thank you very much",
      "thanks for your help",
    ],
  },
  {
    type: "farewell",
    language: "es",
    values: ["adios", "chao", "hasta luego", "hasta pronto", "nos vemos"],
  },
  {
    type: "farewell",
    language: "en",
    values: ["bye", "goodbye", "see you", "see you later"],
  },
  {
    type: "capabilities",
    language: "es",
    values: [
      "quien eres",
      "que eres",
      "que haces",
      "en que me puedes ayudar",
      "como me puedes ayudar",
      "para que sirves",
    ],
  },
  {
    type: "capabilities",
    language: "en",
    values: [
      "who are you",
      "what are you",
      "what do you do",
      "what can you do",
      "how can you help me",
    ],
  },
];

const PHRASE_INDEX = new Map(
  PHRASES.flatMap(({ type, language, values }) =>
    values.map((value) => [value, { type, language }])
  )
);

const SUGGESTIONS = {
  es: [
    {
      id: "assessment",
      label: "Evaluación clínica",
      prompt: "¿Qué debo valorar en un paciente con dolor lumbar?",
    },
    {
      id: "exercise-dosage",
      label: "Dosificación de ejercicio",
      prompt: "¿Cómo dosificar ejercicio terapéutico en una tendinopatía?",
    },
    {
      id: "red-flags",
      label: "Señales de alarma",
      prompt: "¿Qué señales de alarma debo descartar en dolor cervical?",
    },
  ],
  en: [
    {
      id: "assessment",
      label: "Clinical assessment",
      prompt: "What should I assess in a patient with low back pain?",
    },
    {
      id: "exercise-dosage",
      label: "Exercise dosage",
      prompt: "How should therapeutic exercise be dosed for tendinopathy?",
    },
    {
      id: "red-flags",
      label: "Red flags",
      prompt: "Which red flags should I screen for in neck pain?",
    },
  ],
};

function normalizeConversationalText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectConversationalIntent(message = "") {
  const normalized = normalizeConversationalText(message);
  if (!normalized) return null;

  return PHRASE_INDEX.get(normalized) || null;
}

function getReply(type, language) {
  const isEnglish = language === "en";

  if (type === "thanks") {
    return isEnglish
      ? "You’re welcome. Whenever you’re ready, ask me another physiotherapy question."
      : "Con gusto. Cuando quieras, puedes hacerme otra pregunta de fisioterapia.";
  }

  if (type === "farewell") {
    return isEnglish
      ? "See you soon. I’ll be here when you want to review another physiotherapy case or topic."
      : "Hasta pronto. Estaré aquí cuando quieras revisar otro caso o tema de fisioterapia.";
  }

  if (type === "capabilities") {
    return isEnglish
      ? "I’m OpenPhysioAI’s clinical assistant. I can help with assessment, clinical reasoning, therapeutic exercise, dosage, prognosis, and physiotherapy evidence. What case or topic would you like to review?"
      : "Soy el asistente clínico de OpenPhysioAI. Puedo ayudarte con evaluación, razonamiento clínico, ejercicio terapéutico, dosificación, pronóstico y evidencia en fisioterapia. ¿Qué caso o tema quieres revisar?";
  }

  return isEnglish
      ? "Hello! Thanks for saying hi. I’m OpenPhysioAI’s clinical assistant. I can help with assessment, clinical reasoning, therapeutic exercise, dosage, prognosis, and physiotherapy evidence. What case or topic would you like to review?"
      : "¡Hola! Gracias por saludar. Soy el asistente clínico de OpenPhysioAI. Puedo ayudarte con evaluación, razonamiento clínico, ejercicio terapéutico, dosificación, pronóstico y evidencia en fisioterapia. ¿Qué caso o tema quieres revisar?";
}

function buildConversationalChatResponse(message = "") {
  const intent = detectConversationalIntent(message);
  if (!intent) return null;

  const showSuggestions = ["greeting", "capabilities"].includes(intent.type);

  return {
    reply: getReply(intent.type, intent.language),
    structuredResponse: null,
    followUpOptions: showSuggestions ? SUGGESTIONS[intent.language] : [],
    confidence: null,
    evidenceBasis: null,
    libraryRecommendations: [],
    researchReferral: null,
    citationStyle: "none",
    sources: [],
    queryId: null,
    evidenceQuery: null,
    searchStrategy: {
      mode: "conversational",
      language: intent.language,
      intent: intent.type,
    },
    appliedFilters: {},
    evidence_count: 0,
    retrieved_evidence_count: 0,
    cachedEvidence: false,
    responseMode: "conversational",
    conversationalIntentVersion: "1.0.0",
  };
}

module.exports = {
  buildConversationalChatResponse,
  detectConversationalIntent,
  normalizeConversationalText,
};
