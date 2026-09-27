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
  sphincter: /\b(?:urinary retention|retencion urinaria|urinary incontinence|incontinencia (?:urinaria|fecal)|fecal incontinence|bowel (?:or bladder )?dysfunction|bladder dysfunction|disfuncion (?:vesical|esfinter\w*)|perdida de control de esfinteres)\b/,
  bilateral_neuro: /\b(?:bilateral (?:leg|sciatica|weakness|numbness)|ciatica bilateral|debilidad (?:en )?(?:ambas|las dos) piernas|both legs)\b/,
  progressive_deficit: /\b(?:progressive (?:weakness|neurological|numbness)|debilidad progresiva|deficit neurologico progresivo|foot drop|pie caido)\b/,
  myelopathy: /\b(?:clumsy hands|torpeza (?:en las |de )?manos|gait disturbance|alteracion de la marcha|marcha inestable|myelopath\w*|mielopat\w*)\b/,
  cancer_history: /\b(?:history of cancer|cancer history|previous cancer|antecedentes? (?:de )?(?:cancer|neoplasia|oncologic\w*)|cancer de \w+|metasta\w*|tumou?r\w*|oncolog\w*)\b/,
  weight_loss: /\b(?:unexplained weight loss|weight loss|perdida de peso)\b/,
  night_pain: /\b(?:night pain|pain at night|dolor nocturno|dolor (?:que empeora )?por la noche|no mejora con reposo|not relieved by rest|constant pain)\b/,
  fever: /\b(?:fever|fiebre|febril|chills|escalofrios)\b/,
  immunosuppression: /\b(?:immunosuppress\w*|inmunosupres\w*|iv drug|drogas intravenosas|corticosteroid\w* (?:long|prolonged)|corticoides prolongados)\b/,
  major_trauma: /\b(?:major trauma|high[- ]energy trauma|fall from height|caida de altura|accidente de trafico|car accident|traumatismo (?:grave|de alta energia))\b/,
  osteoporosis: /\b(?:osteoporos\w*)\b/,
  calf_signs: /\b(?:calf (?:pain|swelling|tenderness)|dolor (?:en la )?pantorrilla|hinchazon (?:de|en) la pantorrilla|pantorrilla (?:hinchada|caliente|inflamada))\b/,
  swelling_warmth: /\b(?:swelling|hinchazon|edema|warmth|calor|caliente|enrojecimiento|redness)\b/,
  thrombosis_risk: /\b(?:post[- ]?op\w*|postoperatori\w*|arthroplasty|artroplastia|protesis|surgery|cirugia|immobili[sz]\w*|inmoviliza\w*|long[- ]haul flight|vuelo largo|dias despues de (?:una |la )?(?:cirugia|operacion|artroplastia))\b/,
  // "Dolor torácico" is left out: in physiotherapy it usually means thoracic
  // spine pain. Dyspnea alone is routine in respiratory rehabilitation.
  chest_pain: /\b(?:chest pain|dolor en el pecho|dolor precordial|opresion en el pecho|chest tightness)\b/,
  breathlessness: /\b(?:shortness of breath|dyspnoea|dyspnea|disnea|falta de aire|hemoptysis|hemoptisis)\b/,
  cervical_arterial: /\b(?:diplopia|vision doble|dysarthria|disartria|dysphagia|disfagia|drop attacks?|nystagmus|nistagmo|sudden (?:severe )?headache|cefalea (?:subita|en trueno)|thunderclap)\b/,
  dizziness: /\b(?:dizziness|mareo|vertigo)\b/,
  syncope: /\b(?:syncope|sincope|desmayo|fainting|loss of consciousness|perdida de conciencia)\b/,
  self_harm: /\b(?:suicid\w*|self[- ]harm|autoles\w*|quitarse la vida|hacerse dano)\b/,
};

// Each category: which combination of signs raises it, and how urgently the
// patient should be seen.
const CATEGORIES = [
  {
    id: "neurological_compromise",
    urgency: "emergency",
    fires: (s) => s.saddle_anesthesia || s.sphincter || s.bilateral_neuro,
  },
  { id: "progressive_neurological_deficit", urgency: "urgent", fires: (s) => s.progressive_deficit },
  { id: "cervical_myelopathy", urgency: "urgent", fires: (s) => s.myelopathy },
  {
    id: "suspected_malignancy",
    urgency: "prompt",
    fires: (s) => (s.cancer_history && (s.night_pain || s.weight_loss)) || (s.weight_loss && s.night_pain),
  },
  { id: "suspected_infection", urgency: "urgent", fires: (s) => s.fever && (s.immunosuppression || s.swelling_warmth || s.night_pain) },
  { id: "suspected_fracture", urgency: "urgent", fires: (s) => s.major_trauma || (s.osteoporosis && s.major_trauma) },
  {
    id: "vascular_thrombotic",
    urgency: "emergency",
    fires: (s) => (s.calf_signs && (s.swelling_warmth || s.thrombosis_risk)) || ((s.chest_pain || s.breathlessness) && s.thrombosis_risk),
  },
  { id: "cardiorespiratory", urgency: "emergency", fires: (s) => s.chest_pain || s.syncope || (s.breathlessness && s.chest_pain) },
  { id: "cervical_arterial_or_neurovascular", urgency: "emergency", fires: (s) => s.cervical_arterial || (s.dizziness && s.syncope) },
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
    Object.entries(SIGNS).map(([key, pattern]) => [key, pattern.test(userText)])
  );
  const categories = CATEGORIES.filter((category) => category.fires(signs));
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
