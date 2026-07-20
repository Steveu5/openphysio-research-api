function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function sortedSourceIndices(value = []) {
  return Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0)
    )
  ).sort((left, right) => left - right);
}

function buildContextText(question = "", intent = {}) {
  return normalizeText(
    [
      question,
      intent.condition,
      intent.body_region,
      intent.normalized_query,
      intent.diagnosis,
      intent.population,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function isCervicogenicHeadacheContext(question = "", intent = {}) {
  const text = buildContextText(question, intent);
  return (
    /cervicogenic|cervicogenica|cgh/.test(text) ||
    (text.includes("cefalea") && text.includes("cervical")) ||
    (text.includes("headache") && text.includes("neck"))
  );
}

function removeUnsupportedPrecision(value = "", language = "es") {
  let text = String(value || "").trim();

  text = text.replace(
    /\s*\([^)]*\b\d+(?:[.,]\d+)?\s*(?:puntos?|points?|%|por ciento|percent)\b[^)]*\)/gi,
    ""
  );
  text = text.replace(
    /\s*\([^)]*(?:\bOR\b|odds\s+ratio|\bRR\b|risk\s+ratio|\bIC\s*95\b|\bCI\s*95\b|95\s*%\s*(?:IC|CI))[^)]*\)/gi,
    ""
  );
  text = text.replace(
    /\b(?:OR|RR)\s*[=:]?\s*\d+(?:[.,]\d+)?(?:\s*;\s*(?:IC|CI)\s*95\s*%?\s*[-–]?\s*\d+(?:[.,]\d+)?\s*[-–]\s*\d+(?:[.,]\d+)?)?/gi,
    ""
  );
  text = text.replace(
    /\bmejoras?\s+cl[ií]nicamente\s+(?:relevantes?|importantes?)\b/gi,
    language === "en" ? "improvements" : "mejoras"
  );
  text = text.replace(
    /\bclinically\s+(?:meaningful|important)\s+improvements?\b/gi,
    "improvements"
  );
  text = text
    .replace(/\bsignificativamente\s+mayor(?:es)?\b/gi, "mayor")
    .replace(/\bsignificantly\s+(?:higher|greater)\b/gi, "higher")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

  return text;
}

function normalizeSpanishClinicalTone(value = "", language = "es") {
  if (language === "en") return String(value || "").trim();

  return String(value || "")
    .replace(/^Combine\b/i, "Combina")
    .replace(/^Eval[uú]e\b/i, "Evalúa")
    .replace(/^Valore\b/i, "Valora")
    .replace(/^Considere\b/i, "Considera")
    .replace(/\bconsidere\b/g, "considera")
    .replace(/\bConsidere\b/g, "Considera")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function softenClinicalLanguage(value = "", language = "es") {
  let text = removeUnsupportedPrecision(value, language);

  if (language === "en") {
    text = text
      .replace(/^Prescribe\b/i, "Consider")
      .replace(/^Avoid passive interventions\b/i, "Do not rely exclusively on passive interventions")
      .replace(/\bproves?\b/gi, "suggests")
      .replace(/\bguarantees?\b/gi, "may support")
      .replace(
        /\b(?:show|shows|demonstrate|demonstrates|provide|provides)\s+significant\s+(?:benefits?|improvements?)\b/gi,
        "may improve some outcomes"
      )
      .replace(
        /\bsignificant\s+(?:benefits?|improvements?)\b/gi,
        "possible improvements"
      )
      .replace(/\bhigh-quality\s+evidence\b/gi, "available evidence");
  } else {
    text = text
      .replace(/^Prescriba\b/i, "Considera")
      .replace(/^Evite intervenciones pasivas\b/i, "No dependas exclusivamente de intervenciones pasivas")
      .replace(/\bdemuestra\b/gi, "sugiere")
      .replace(/\bgarantiza\b/gi, "puede favorecer")
      .replace(
        /\b(?:muestran?|demuestran?|ofrecen?|producen?)\s+beneficios?\s+significativos?\b/gi,
        "pueden mejorar algunos resultados"
      )
      .replace(/\bbeneficios?\s+significativos?\b/gi, "posibles beneficios")
      .replace(/\bmejoras?\s+significativas?\b/gi, "posibles mejoras")
      .replace(/\bevidencia\s+de\s+alta\s+calidad\b/gi, "evidencia disponible");
    text = normalizeSpanishClinicalTone(text, language);
  }

  return text.trim();
}

function refineClaim(item = {}, language = "es") {
  return {
    ...item,
    text: softenClinicalLanguage(item.text, language),
    source_indices: sortedSourceIndices(item.source_indices),
  };
}

function deduplicateClaims(items = [], language = "es", limit = 4) {
  const seen = new Set();
  const result = [];

  for (const rawItem of Array.isArray(items) ? items : []) {
    const item = refineClaim(rawItem, language);
    const key = normalizeText(item.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }

  return result;
}

function articleTypeText(article = {}) {
  return normalizeText(
    [article.evidence_level, article.study_type, article.title]
      .filter(Boolean)
      .join(" ")
  );
}

function isGuidelineArticle(article = {}) {
  const text = articleTypeText(article);
  return (
    text.includes("guideline") ||
    text.includes("guia de practica clinica") ||
    text.includes("clinical practice guideline")
  );
}

function isReviewArticle(article = {}) {
  const text = articleTypeText(article);
  return (
    text.includes("systematic") ||
    text.includes("meta analysis") ||
    text.includes("meta-analysis") ||
    text.includes("revision sistematica") ||
    text.includes("cochrane")
  );
}

function isTrialArticle(article = {}) {
  const text = articleTypeText(article);
  return (
    text.includes("randomized") ||
    text.includes("randomised") ||
    text.includes("ensayo clinico") ||
    text.includes("clinical trial")
  );
}

function isTemporomandibularArticle(article = {}) {
  const text = articleTypeText(article);
  return /temporomandibular|orofacial|\btmd\b|atm|mandibular/.test(text);
}

function isManualExerciseArticle(article = {}) {
  const text = articleTypeText(article);
  return (
    /manual\s+therapy|terapia\s+manual|mobilization|mobilisation|manipulation|movilizacion|manipulacion/.test(text) ||
    /exercise|ejercicio|control\s+motor|proprioceptive|propioceptivo/.test(text)
  );
}

function indicesFor(articles = [], predicate) {
  return (Array.isArray(articles) ? articles : [])
    .map((article, index) => ({ article, index: index + 1 }))
    .filter(({ article }) => predicate(article))
    .map(({ index }) => index);
}

function allAvailableIndices(articles = []) {
  return sortedSourceIndices(
    (Array.isArray(articles) ? articles : []).map((_, index) => index + 1)
  ).slice(0, 4);
}

function buildEvidenceRelationship(articles = [], language = "es") {
  const guidelineIndices = indicesFor(articles, isGuidelineArticle);
  const reviewIndices = indicesFor(articles, isReviewArticle);
  const trialIndices = indicesFor(articles, isTrialArticle);
  const allIndices = sortedSourceIndices([
    ...guidelineIndices,
    ...reviewIndices,
    ...trialIndices,
  ]).slice(0, 4);

  if (!allIndices.length) return null;

  if (guidelineIndices.length && reviewIndices.length) {
    return {
      text:
        language === "en"
          ? "The guideline provides the general clinical framework, while systematic reviews estimate the benefits and limitations of the interventions; clinical studies add detail about specific modalities without establishing one universally superior option."
          : "La guía aporta el marco clínico general, mientras las revisiones sistemáticas estiman los beneficios y límites de las intervenciones; los estudios clínicos añaden información sobre modalidades concretas sin establecer una opción universalmente superior.",
      source_indices: allIndices,
    };
  }

  if (reviewIndices.length && trialIndices.length) {
    return {
      text:
        language === "en"
          ? "Systematic reviews describe the overall direction of the evidence, while clinical trials provide detail about specific interventions; both should be interpreted according to the individual patient context."
          : "Las revisiones sistemáticas describen la orientación general de la evidencia y los ensayos clínicos aportan detalle sobre intervenciones concretas; ambos deben interpretarse según el contexto individual del paciente.",
      source_indices: allIndices,
    };
  }

  return {
    text:
      language === "en"
        ? "The available sources support general clinical principles, but they do not justify treating a single modality as universally superior."
        : "Las fuentes disponibles respaldan principios clínicos generales, pero no justifican considerar una modalidad como universalmente superior.",
    source_indices: allIndices,
  };
}

function buildCervicogenicEvidenceRelationship(articles = [], language = "es") {
  const indices = allAvailableIndices(articles);
  if (!indices.length) return null;

  return {
    text:
      language === "en"
        ? "The neck pain guideline provides a related clinical framework, but it does not replace evidence specific to cervicogenic headache or the clinical examination of the headache pattern. Associated findings such as temporomandibular symptoms should be interpreted as complementary, not as the default treatment target."
        : "La guía de dolor cervical aporta un marco clínico relacionado, pero no sustituye la evidencia específica de cefalea cervicogénica ni la evaluación clínica del patrón de cefalea. Hallazgos asociados como síntomas temporomandibulares deben interpretarse como complementarios, no como el objetivo principal por defecto.",
    source_indices: indices,
  };
}

function buildFollowUpQuestion(question = "", intent = {}, language = "es") {
  const text = buildContextText(question, intent);

  if (/lumbar|low back|lumbalgia|espalda baja/.test(text)) {
    return language === "en"
      ? "To refine the recommendation, what currently limits the patient most—pain, activity tolerance, sleep, or participation—and what type of exercise has already been tried?"
      : "Para afinar la recomendación, ¿qué limita más al paciente actualmente —dolor, tolerancia a la actividad, sueño o participación— y qué tipo de ejercicio ya ha probado?";
  }

  if (/cervical|neck|cefalea|headache/.test(text)) {
    return language === "en"
      ? "To refine the recommendation, is the main problem neck pain, headache burden, or functional limitation, and which interventions have already been tried?"
      : "Para afinar la recomendación, ¿predomina el dolor cervical, la carga de cefalea o la limitación funcional, y qué intervenciones ya se han probado?";
  }

  if (/rodilla|knee/.test(text)) {
    return language === "en"
      ? "To refine the recommendation, what activity is most limited and is the main problem pain, strength, swelling, or confidence during loading?"
      : "Para afinar la recomendación, ¿qué actividad está más limitada y predomina el dolor, la pérdida de fuerza, la inflamación o la inseguridad durante la carga?";
  }

  return language === "en"
    ? "To refine the recommendation, what is the patient's main functional limitation and which treatments or exercises have already been tried?"
    : "Para afinar la recomendación, ¿cuál es la principal limitación funcional del paciente y qué tratamientos o ejercicios ya se han probado?";
}

function refineConfidence(confidence = {}, articles = [], language = "es") {
  const highLevelDirect = (Array.isArray(articles) ? articles : []).filter(
    (article) =>
      Number(article.query_relevance_score || 0) >= 65 &&
      Number(article.evidence_level_rank || 0) >= 7
  ).length;

  let score = Math.min(88, Number(confidence.score || 0));
  if (highLevelDirect < 2) score = Math.min(score, 80);
  if (!articles.length) score = 0;

  const levelKey = score >= 75 ? "high" : score >= 50 ? "moderate" : "limited";
  const labels = {
    es: { high: "Alto", moderate: "Moderado", limited: "Limitado" },
    en: { high: "High", moderate: "Moderate", limited: "Limited" },
  };
  const rationale =
    language === "en"
      ? highLevelDirect >= 2
        ? "Confidence is high for the general direction of care, but lower for selecting a specific modality, dose, or progression because the evidence is heterogeneous."
        : "The available evidence supports general clinical principles, but certainty is lower for specific prescriptions and patient-level decisions."
      : highLevelDirect >= 2
        ? "La confianza es alta para la orientación general del manejo, pero menor para elegir una modalidad, dosis o progresión específica porque la evidencia es heterogénea."
        : "La evidencia disponible respalda principios clínicos generales, pero la certeza es menor para prescripciones específicas y decisiones individuales.";

  return {
    ...confidence,
    level: labels[language]?.[levelKey] || labels.es[levelKey],
    level_key: levelKey,
    score,
    rationale,
    metrics: {
      ...(confidence.metrics || {}),
      concise_chat_high_level_direct_count: highLevelDirect,
      concise_chat_confidence_version: "1.2.0",
    },
  };
}

function adjustCervicogenicConfidence(confidence = {}, language = "es") {
  const score = Math.min(78, Number(confidence.score || 78) || 78);
  const isEnglish = language === "en";

  return {
    ...confidence,
    level: isEnglish ? "Moderate" : "Moderado",
    level_key: "moderate",
    score,
    rationale: isEnglish
      ? "Confidence is moderate because the neck pain guideline is a related framework and the available evidence specific to cervicogenic headache is heterogeneous; treatment choice still depends on the clinical headache pattern and response to loading."
      : "La confianza es moderada porque la guía de dolor cervical es un marco relacionado y la evidencia específica sobre cefalea cervicogénica es heterogénea; la elección del tratamiento depende del patrón clínico de cefalea y de la respuesta a la carga.",
    metrics: {
      ...(confidence.metrics || {}),
      cervicogenic_headache_scope_guard_version: "1.0.0",
    },
  };
}

function applyCervicogenicHeadacheGuard(structured = {}, articles = [], language = "es") {
  const guidelineIndices = indicesFor(articles, isGuidelineArticle);
  const reviewIndices = indicesFor(articles, isReviewArticle);
  const manualExerciseIndices = indicesFor(articles, isManualExerciseArticle);
  const tmdIndices = indicesFor(articles, isTemporomandibularArticle);
  const allIndices = allAvailableIndices(articles);
  const frameworkIndices = sortedSourceIndices([
    ...guidelineIndices.slice(0, 1),
    ...reviewIndices.slice(0, 2),
  ]).slice(0, 4);
  const treatmentIndices = sortedSourceIndices([
    ...manualExerciseIndices,
    ...guidelineIndices.slice(0, 1),
  ]).slice(0, 4);
  const relatedIndices = tmdIndices.length ? tmdIndices : allIndices;
  const isEnglish = language === "en";

  return {
    ...structured,
    brief_answer: isEnglish
      ? [
          {
            text: "For cervicogenic headache, the neck pain guideline is a related clinical framework, but it should not replace condition-specific evidence or examination of the headache pattern.",
            source_indices: frameworkIndices.length ? frameworkIndices : allIndices,
          },
          {
            text: "Available evidence supports considering cervical exercise and manual therapy within an individualized plan; dose and progression should depend on irritability, symptom response, and functional goals.",
            source_indices: treatmentIndices.length ? treatmentIndices : allIndices,
          },
        ]
      : [
          {
            text: "En cefalea cervicogénica, la guía de dolor cervical aporta un marco clínico relacionado, pero no sustituye la evidencia específica ni la evaluación clínica del patrón de cefalea.",
            source_indices: frameworkIndices.length ? frameworkIndices : allIndices,
          },
          {
            text: "La evidencia disponible apoya considerar ejercicio terapéutico cervical y terapia manual dentro de un plan individualizado; la dosis y progresión deben ajustarse según irritabilidad, respuesta y objetivos funcionales.",
            source_indices: treatmentIndices.length ? treatmentIndices : allIndices,
          },
        ],
    evidence_relationships: [
      buildCervicogenicEvidenceRelationship(articles, language),
    ].filter(Boolean),
    clinical_application: isEnglish
      ? [
          {
            text: "Assess upper cervical mobility, cervical motor control, headache burden, disability, and symptom reproduction or modulation before selecting the intervention.",
            source_indices: frameworkIndices.length ? frameworkIndices : allIndices,
          },
          {
            text: "Consider manual therapy and therapeutic cervical exercise when the clinical pattern is compatible and irritability allows mechanical loading.",
            source_indices: treatmentIndices.length ? treatmentIndices : allIndices,
          },
          {
            text: "Screen the temporomandibular joint only when there is orofacial pain, clicking, mandibular limitation, or compatible symptoms; use it as an associated factor rather than the default treatment target.",
            source_indices: relatedIndices,
          },
        ]
      : [
          {
            text: "Evalúa movilidad cervical alta, control motor cervical, carga de cefalea, discapacidad y reproducción o modulación de síntomas antes de elegir la intervención.",
            source_indices: frameworkIndices.length ? frameworkIndices : allIndices,
          },
          {
            text: "Considera terapia manual y ejercicio terapéutico cervical cuando el patrón clínico sea compatible y la irritabilidad permita carga mecánica.",
            source_indices: treatmentIndices.length ? treatmentIndices : allIndices,
          },
          {
            text: "Explora la articulación temporomandibular solo si hay dolor orofacial, chasquidos, limitación mandibular o síntomas compatibles; úsala como factor asociado, no como eje principal por defecto.",
            source_indices: relatedIndices,
          },
        ],
    assessment_considerations: isEnglish
      ? [
          {
            text: "Differentiate cervicogenic headache from other headache patterns and review neurological signs, atypical symptoms, or red flags before treating it as a musculoskeletal presentation.",
            source_indices: frameworkIndices.length ? frameworkIndices : allIndices,
          },
          {
            text: "Define whether neck pain, headache burden, functional limitation, or mechanical sensitivity is the dominant problem to guide progression.",
            source_indices: allIndices,
          },
        ]
      : [
          {
            text: "Diferencia cefalea cervicogénica de otros patrones de cefalea y revisa signos neurológicos, síntomas atípicos o banderas rojas antes de tratarla como cuadro musculoesquelético.",
            source_indices: frameworkIndices.length ? frameworkIndices : allIndices,
          },
          {
            text: "Define si predomina dolor cervical, carga de cefalea, limitación funcional o sensibilidad a la carga mecánica para guiar la progresión.",
            source_indices: allIndices,
          },
        ],
    precautions: isEnglish
      ? [
          {
            text: "Do not treat the cervicogenic headache and temporomandibular disorder association as causal or as an automatic treatment priority; the association evidence is mainly complementary.",
            source_indices: relatedIndices,
          },
          {
            text: "Do not present a general neck pain guideline or broad neck pain review as exclusive evidence for cervicogenic headache.",
            source_indices: allIndices,
          },
        ]
      : [
          {
            text: "No interpretes la asociación entre cefalea cervicogénica y trastornos temporomandibulares como causal ni como prioridad automática de tratamiento; es evidencia complementaria.",
            source_indices: relatedIndices,
          },
          {
            text: "No presentes una guía general de dolor cervical o una revisión amplia de dolor cervical como evidencia exclusiva para cefalea cervicogénica.",
            source_indices: allIndices,
          },
        ],
    confidence: adjustCervicogenicConfidence(structured.confidence || {}, language),
  };
}

function refineStructuredClinicalChatFinal(
  structured = {},
  articles = [],
  language = "es",
  { question = "", intent = {} } = {}
) {
  const confidence = refineConfidence(
    structured.confidence || {},
    articles,
    language
  );
  const relationship = buildEvidenceRelationship(articles, language);
  let result = {
    ...structured,
    brief_answer: deduplicateClaims(structured.brief_answer, language, 2),
    evidence_relationships: relationship ? [relationship] : [],
    clinical_application: deduplicateClaims(
      structured.clinical_application,
      language,
      3
    ),
    assessment_considerations: deduplicateClaims(
      structured.assessment_considerations,
      language,
      2
    ),
    precautions: deduplicateClaims(structured.precautions, language, 2),
    follow_up_question: buildFollowUpQuestion(question, intent, language),
    confidence,
  };

  if (isCervicogenicHeadacheContext(question, intent)) {
    result = applyCervicogenicHeadacheGuard(result, articles, language);
  }

  return result;
}

function citationSuffix(indices = []) {
  const normalized = sortedSourceIndices(indices);
  return normalized.length ? ` [${normalized.join(",")}]` : "";
}

function stripTrailingCitationGroups(value = "") {
  return String(value || "")
    .replace(/(?:\s*\[\s*\d+(?:\s*,\s*\d+)*\s*\])+\s*$/g, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function collapseDuplicateAdjacentCitations(value = "") {
  return String(value || "").replace(
    /\[\s*(\d+(?:\s*,\s*\d+)*)\s*\]\s+\[\s*(\d+(?:\s*,\s*\d+)*)\s*\]/g,
    (match, left, right) => {
      const normalize = (group) =>
        group
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .join(",");
      const normalizedLeft = normalize(left);
      const normalizedRight = normalize(right);
      return normalizedLeft === normalizedRight
        ? `[${normalizedLeft}]`
        : `[${normalizedLeft}] [${normalizedRight}]`;
    }
  );
}

function renderClaim(item = {}) {
  const suffix = citationSuffix(item.source_indices);
  const rawText = String(item.text || "").trim();
  const text = suffix ? stripTrailingCitationGroups(rawText) : rawText;
  return collapseDuplicateAdjacentCitations(`${text}${suffix}`.trim());
}

function buildChatEvidenceSynthesisLine(articles = [], language = "es") {
  const list = Array.isArray(articles) ? articles.slice(0, 4) : [];
  const citations = list.length
    ? ` [${list.map((_, index) => index + 1).join(",")}]`
    : "";
  const hasGuideline = list.some(isGuidelineArticle);
  const hasReview = list.some(isReviewArticle);
  const hasTrial = list.some(isTrialArticle);

  if (language === "en") {
    if (hasGuideline && (hasReview || hasTrial)) {
      return `Evidence synthesis: integrates a clinical guideline with prioritized systematic reviews and clinical studies; the guideline is not used as the sole source.${citations}`;
    }
    if (hasReview && hasTrial) {
      return `Evidence synthesis: integrates systematic reviews with prioritized clinical studies.${citations}`;
    }
    return `Evidence synthesis: uses the best prioritized evidence available for this question.${citations}`;
  }

  if (hasGuideline && (hasReview || hasTrial)) {
    return `Síntesis de evidencia: integra una guía clínica con revisiones sistemáticas y estudios clínicos priorizados; la guía no se utiliza como fuente exclusiva.${citations}`;
  }
  if (hasReview && hasTrial) {
    return `Síntesis de evidencia: integra revisiones sistemáticas con estudios clínicos priorizados.${citations}`;
  }
  return `Síntesis de evidencia: utiliza la mejor evidencia priorizada disponible para esta pregunta.${citations}`;
}

function injectChatEvidenceSynthesisIntoReply(
  reply = "",
  articles = [],
  language = "es",
  { markdown = false } = {}
) {
  const line = buildChatEvidenceSynthesisLine(articles, language);
  const text = String(reply || "").trim();
  if (!text) return line;

  const lines = text.split("\n");
  const insertion = markdown ? `**${line}**` : line;
  lines.splice(Math.min(1, lines.length), 0, insertion);
  return collapseDuplicateAdjacentCitations(lines.join("\n"));
}

function renderConciseChatReply(structured = {}, language = "es") {
  const isEnglish = language === "en";
  const labels = isEnglish
    ? {
        answer: "**Clinical answer**",
        relationships: "**How the evidence fits together**",
        application: "**Clinical application**",
        assessment: "**Assess before applying**",
        precautions: "**Limits and precautions**",
        confidence: "**Confidence**",
        continue: "**To continue**",
      }
    : {
        answer: "**Respuesta clínica**",
        relationships: "**Cómo se relaciona la evidencia**",
        application: "**Aplicación clínica**",
        assessment: "**Antes de aplicarlo**",
        precautions: "**Límites y precauciones**",
        confidence: "**Confianza**",
        continue: "**Para continuar**",
      };

  const lines = [labels.answer];
  (structured.brief_answer || []).forEach((item) => lines.push(renderClaim(item)));

  if (structured.evidence_relationships?.length) {
    lines.push("", labels.relationships);
    structured.evidence_relationships.forEach((item) =>
      lines.push(renderClaim(item))
    );
  }

  const sections = [
    [labels.application, structured.clinical_application],
    [labels.assessment, structured.assessment_considerations],
    [labels.precautions, structured.precautions],
  ];

  sections.forEach(([label, items]) => {
    if (!items?.length) return;
    lines.push("", label);
    items.forEach((item) => lines.push(`- ${renderClaim(item)}`));
  });

  if (structured.confidence) {
    lines.push(
      "",
      labels.confidence,
      `${structured.confidence.level} (${structured.confidence.score}/100). ${structured.confidence.rationale}`
    );
  }

  if (structured.follow_up_question) {
    lines.push("", labels.continue, structured.follow_up_question);
  }

  return collapseDuplicateAdjacentCitations(lines.join("\n").trim());
}

module.exports = {
  removeUnsupportedPrecision,
  normalizeSpanishClinicalTone,
  stripTrailingCitationGroups,
  collapseDuplicateAdjacentCitations,
  isCervicogenicHeadacheContext,
  refineStructuredClinicalChatFinal,
  renderConciseChatReply,
  refineConfidence,
  buildEvidenceRelationship,
  buildCervicogenicEvidenceRelationship,
  buildFollowUpQuestion,
  buildChatEvidenceSynthesisLine,
  injectChatEvidenceSynthesisIntoReply,
};
