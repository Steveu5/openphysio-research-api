// General red-flag screen for Clinical Chat.
//
// Organized by screening category (the categories physiotherapists screen
// for), not by pathology: each category fires on one strong sign or on a
// combination of weaker ones, read from the clinician's own messages. The
// answer model adds a second opinion (`safety_concern`) for combinations the
// rules do not cover. A positive screen puts safety first: the answer
// recommends medical evaluation or referral with an urgency proportional to
// the category, without diagnosing and without alarmist wording.

const VERSION = "1.0.0";

function normalize(text = "") {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const SIGNS = {
  saddle_anesthesia: /\b(?:saddle (?:anaesthesia|anesthesia|numbness)|anestesia en silla de montar|hipoestesia en silla de montar|silla de montar|perineal numbness|entumecimiento perineal)\b/,
  urinary_retention: /\b(?:urinary retention|retencion urinaria|unable to urinate|no puede orinar|bowel (?:or bladder )?dysfunction|perdida de control de esfinteres)\b/,
  // Incontinence is routine in pelvic-floor physiotherapy; it only counts
  // together with back pain / radicular symptoms (see CATEGORIES).
  incontinence: /\b(?:urinary incontinence|incontinencia (?:urinaria|fecal)|fecal incontinence)\b/,
  stress_incontinence: /\b(?:incontinencia (?:urinaria )?de esfuerzo|stress (?:urinary )?incontinence|posparto|postpartum|suelo pelvico|pelvic floor)\b/,
  back_or_radicular: /\b(?:lumbalgia|dolor lumbar|low back pain|back pain|ciatica|sciatica|radicul\w*|lumbar)\b/,
  bilateral_neuro: /\b(?:bilateral (?:leg|sciatica|weakness|numbness|radicul\w*)|ciatica bilateral|(?:ciatica|debilidad|hormigueo|entumecimiento|adormecimiento|parestesias?) (?:en )?(?:ambas|las dos) piernas|(?:sciatica|weakness|numbness) in both legs)\b/,
  progressive_deficit: /\b(?:progressive (?:weakness|neurological deficit|numbness)|debilidad progresiva|deficit neurologico progresivo|empeoramiento neurologico)\b/,
  myelopathy: /\b(?:myelopath\w*|mielopat\w*)\b/,
  clumsy_hands: /\b(?:clumsy hands|torpeza (?:en las |de las |de )?manos|perdida de destreza manual)\b/,
  gait_disturbance: /\b(?:gait disturbance|alteracion de la marcha|marcha inestable|unsteady gait)\b/,
  neck_context: /\b(?:neck|cervical|cuello|cervicalgia)\b/,
  // Neurological or stroke rehabilitation context, where gait changes,
  // dysphagia or foot drop are the known condition, not a new red flag.
  known_neuro_condition: /\b(?:ictus|stroke|acv|parkinson|esclerosis multiple|multiple sclerosis|lesion medular|spinal cord injury|paralisis cerebral|cerebral palsy|lesion del (?:nervio )?peroneo|peroneal nerve)\b/,
  cancer_history: /\b(?:history of cancer|cancer history|previous cancer|antecedentes? (?:de )?(?:cancer|neoplasia|oncologic\w*)|cancer de \w+|metasta\w*|tumou?r\w*|oncolog\w*)\b/,
  weight_loss: /\b(?:unexplained weight loss|weight loss|perdida de peso)\b/,
  intentional_weight_loss: /\b(?:intencional|voluntaria|con dieta|dieta|intentional|dieting|on a diet)\b/,
  night_pain: /\b(?:night pain|pain at night|dolor nocturno|dolor (?:que empeora )?por la noche|no mejora con reposo|not relieved by rest|constant pain|dolor constante)\b/,
  // Night pain from lying on the painful side is mechanical.
  positional_night_pain: /\b(?:al (?:dormir|acostarse) sobre|lying on (?:the|that|affected) side|sobre ese lado|sobre el lado)\b/,
  fever: /\b(?:fever|fiebre|febril|chills|escalofrios)\b/,
  immunosuppression: /\b(?:immunosuppress\w*|inmunosupres\w*|iv drug|drogas intravenosas|corticosteroid\w* (?:long|prolonged)|corticoides prolongados)\b/,
  major_trauma: /\b(?:major trauma|high[- ]energy trauma|fall from height|caida de altura|accidente de trafico|car accident|traumatismo (?:grave|de alta energia))\b/,
  remote_history: /\b(?:hace (?:\d+|varios|muchos|unos) (?:anos|meses)|years ago|months ago|chronic|cronic[oa]|en (?:la )?historia|history of)\b/,
  osteoporosis: /\b(?:osteoporos\w*)\b/,
  calf_signs: /\b(?:calf (?:pain|swelling|tenderness)|dolor (?:en la )?pantorrilla|hinchazon (?:de|en) la pantorrilla|pantorrilla (?:hinchada|caliente|inflamada))\b/,
  swelling: /\b(?:swelling|swollen|hinchazon|hinchada|edema|inflamada)\b/,
  warmth: /\b(?:warmth|warm|calor|caliente|enrojecimiento|redness)\b/,
  muscle_injury: /\b(?:tiron|desgarro|rotura fibrilar|distension|strain|tear|pulled muscle|contusion|golpe)\b/,
  thrombosis_risk: /\b(?:post[- ]?op\w*|postoperatori\w*|arthroplasty|artroplastia|protesis|surgery|cirugia|immobili[sz]\w*|inmoviliza\w*|yeso|cast|long[- ]haul flight|vuelo largo|dias despues de (?:una |la )?(?:cirugia|operacion|artroplastia)|anticoncept\w*|embaraz\w*|pregnan\w*)\b/,
  // "Dolor torácico" is left out: in physiotherapy it usually means thoracic
  // spine pain. Dyspnea alone is routine in respiratory rehabilitation.
  chest_pain: /\b(?:chest pain|dolor en el pecho|dolor precordial|opresion en el pecho|chest tightness)\b/,
  cardiac_features: /\b(?:sudor\w*|sweating|diaphores\w*|irradia\w* (?:al|a la|hacia el) (?:brazo|mandibula|cuello)|radiating to (?:the )?(?:arm|jaw)|con el esfuerzo|on exertion|exertional|palpitacion\w*|palpitations)\b/,
  mechanical_chest: /\b(?:al palpar|a la palpacion|on palpation|pectoral|costocondral|costochondral|intercostal|press de banca|bench press|con el movimiento|with movement|musculoesqueletic\w*|musculoskeletal)\b/,
  breathlessness: /\b(?:shortness of breath|dyspnoea|dyspnea|disnea|falta de aire|hemoptysis|hemoptisis)\b/,
  sudden_breathlessness: /\b(?:disnea (?:subita|repentina|brusca)|sudden (?:shortness of breath|dyspn\w*)|hemoptysis|hemoptisis)\b/,
  // 5D/3N signs of cervical arterial dysfunction. One of them alone is
  // common (vestibular rehab nystagmus, dysphagia rehab); two or more, a
  // sudden severe headache, or one after neck manipulation/trauma is not.
  neurovascular_sign: /\b(?:diplopia|vision doble|dysarthria|disartria|dysphagia|disfagia|drop attacks?|nystagmus|nistagmo|numbness of the face|entumecimiento facial|ataxia)\b/g,
  thunderclap: /\b(?:sudden (?:severe )?headache|thunderclap|cefalea (?:subita|en trueno)|peor dolor de cabeza de su vida|worst headache)\b/,
  neck_manipulation_or_trauma: /\b(?:manipulation|manipulacion|thrust|latigazo|whiplash|traumatismo cervical)\b/,
  vestibular_context: /\b(?:vppb|bppv|dix-hallpike|vestibular|epley)\b/,
  syncope: /\b(?:syncope|sincope|desmayo|fainting|loss of consciousness|perdida de conciencia)\b/,
  exertional: /\b(?:durante el (?:ejercicio|esfuerzo)|during (?:exercise|exertion)|al hacer ejercicio|con el esfuerzo|on exertion)\b/,
  self_harm: /\b(?:suicid\w*|self[- ]harm|autoles\w*|quitarse la vida|hacerse dano)\b/,
};

function neurovascularCount(text = "") {
  return new Set((text.match(SIGNS.neurovascular_sign) || []).map((sign) => sign.slice(0, 5))).size;
}

// Each category: which combination of signs raises it, and how urgently the
// patient should be seen. `t` is the normalized clinician text.
const CATEGORIES = [
  {
    id: "neurological_compromise",
    urgency: "emergency",
    fires: (s) =>
      s.saddle_anesthesia ||
      s.bilateral_neuro ||
      (s.urinary_retention && s.back_or_radicular) ||
      (s.incontinence && !s.stress_incontinence && s.back_or_radicular),
  },
  { id: "progressive_neurological_deficit", urgency: "urgent", fires: (s) => s.progressive_deficit },
  {
    id: "cervical_myelopathy",
    urgency: "urgent",
    fires: (s) =>
      (s.myelopathy && !s.remote_history) ||
      (s.clumsy_hands && (s.gait_disturbance || s.neck_context) && !s.known_neuro_condition),
  },
  {
    id: "suspected_malignancy",
    urgency: "prompt",
    fires: (s) => {
      const nightPain = s.night_pain && !s.positional_night_pain;
      const weightLoss = s.weight_loss && !s.intentional_weight_loss;
      return (s.cancer_history && (nightPain || weightLoss)) || (weightLoss && nightPain);
    },
  },
  { id: "suspected_infection", urgency: "urgent", fires: (s) => s.fever && (s.immunosuppression || s.swelling || s.warmth || s.night_pain) },
  {
    id: "suspected_fracture",
    urgency: "urgent",
    fires: (s) => s.major_trauma && !s.remote_history,
  },
  {
    id: "vascular_thrombotic",
    urgency: "emergency",
    fires: (s) =>
      (s.calf_signs && s.thrombosis_risk) ||
      (s.calf_signs && s.swelling && s.warmth && !s.muscle_injury) ||
      ((s.chest_pain || s.sudden_breathlessness) && s.thrombosis_risk),
  },
  {
    id: "cardiorespiratory",
    urgency: "emergency",
    fires: (s) =>
      (s.chest_pain && !s.mechanical_chest && (s.cardiac_features || s.breathlessness)) ||
      (s.chest_pain && s.cardiac_features) ||
      (s.syncope && s.exertional),
  },
  {
    id: "cervical_arterial_or_neurovascular",
    urgency: "emergency",
    fires: (s, t) =>
      s.thunderclap ||
      (!s.vestibular_context && !s.known_neuro_condition && neurovascularCount(t) >= 2) ||
      (neurovascularCount(t) >= 1 && s.neck_manipulation_or_trauma),
  },
  { id: "mental_health_risk", urgency: "emergency", fires: (s) => s.self_harm },
];

const URGENCY_ORDER = ["prompt", "urgent", "emergency"];

function screenRedFlags({ question = "", messages = [] } = {}) {
  const userText = normalize(
    [
      ...(Array.isArray(messages) ? messages : [])
        .filter((message) => !["assistant", "bot", "system"].includes(String(message.role || "user").toLowerCase()))
        .map((message) => message.content || message.text || ""),
      question,
    ].join(" \n ")
  );
  const signs = Object.fromEntries(
    Object.entries(SIGNS).map(([key, pattern]) => {
      pattern.lastIndex = 0;
      const found = pattern.test(userText);
      pattern.lastIndex = 0;
      return [key, found];
    })
  );
  const categories = CATEGORIES.filter((category) => category.fires(signs, userText));
  const urgency = categories.reduce(
    (current, category) =>
      URGENCY_ORDER.indexOf(category.urgency) > URGENCY_ORDER.indexOf(current) ? category.urgency : current,
    categories.length ? "prompt" : null
  );

  return {
    version: VERSION,
    status: categories.length ? "red_flag" : "none",
    categories: categories.map((category) => category.id),
    urgency,
    signs: Object.keys(signs).filter((key) => signs[key]),
    source: categories.length ? "rules" : null,
  };
}

// Combines the rule screen with the answer model's own safety concern.
function mergeModelSafetyConcern(screen = {}, concern = null) {
  if (screen.status === "red_flag") return screen;
  if (!concern || concern.present !== true) return screen;
  return {
    ...screen,
    status: "possible_red_flag",
    urgency: "prompt",
    source: "model",
    model_reason: String(concern.reason || "").slice(0, 300) || null,
  };
}

const MESSAGES = {
  es: {
    emergency:
      "Prioridad de seguridad: los signos descritos pueden corresponder a una condición que requiere valoración médica urgente. Antes de aplicar ejercicio, terapia manual u otras técnicas, deriva al paciente para evaluación médica inmediata (servicio de urgencias).",
    urgent:
      "Prioridad de seguridad: los signos descritos justifican una evaluación médica pronta, idealmente en las próximas 24–48 horas, antes de iniciar o continuar el tratamiento de fisioterapia.",
    prompt:
      "Prioridad de seguridad: la combinación de signos descritos justifica derivar al paciente para evaluación médica antes de continuar con el tratamiento; no es un diagnóstico, pero sí un motivo para descartar una causa no musculoesquelética.",
    possible:
      "Precaución: algunos datos del caso podrían requerir descartar una causa no musculoesquelética. Si se confirman, prioriza la evaluación médica antes de progresar el tratamiento.",
  },
  en: {
    emergency:
      "Safety first: the signs described may reflect a condition that needs urgent medical assessment. Before any exercise, manual therapy or other techniques, refer the patient for immediate medical evaluation (emergency department).",
    urgent:
      "Safety first: the signs described warrant prompt medical evaluation, ideally within 24–48 hours, before starting or continuing physiotherapy treatment.",
    prompt:
      "Safety first: this combination of signs warrants referral for medical evaluation before continuing treatment; it is not a diagnosis, but it is a reason to rule out a non-musculoskeletal cause.",
    possible:
      "Caution: some details of the case may require ruling out a non-musculoskeletal cause. If they are confirmed, prioritize medical evaluation before progressing treatment.",
  },
};

function safetyMessage(safety = {}, language = "es") {
  const lang = language === "en" ? "en" : "es";
  if (safety.status === "red_flag") return MESSAGES[lang][safety.urgency || "prompt"];
  if (safety.status === "possible_red_flag") return MESSAGES[lang].possible;
  return null;
}

// Puts the safety statement first in the structured Chat answer.
function applySafetyToStructure(structured = {}, safety = {}, language = "es") {
  const message = safetyMessage(safety, language);
  if (!message) return structured;
  return {
    ...structured,
    brief_answer: [{ text: message, source_indices: [] }, ...(structured.brief_answer || [])],
    safety: { ...safety, message },
  };
}

module.exports = {
  VERSION,
  screenRedFlags,
  mergeModelSafetyConcern,
  safetyMessage,
  applySafetyToStructure,
};
