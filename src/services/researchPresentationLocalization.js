const ES_TO_EN = new Map([
  ["Guía de práctica clínica", "Clinical practice guideline"],
  ["Revisión sistemática y metaanálisis", "Systematic review and meta-analysis"],
  ["Revisión sistemática", "Systematic review"],
  ["Ensayo clínico aleatorizado", "Randomized controlled trial"],
  ["Estudio de cohorte", "Cohort study"],
  ["Caso-control", "Case-control study"],
  ["Transversal", "Cross-sectional study"],
  ["Reporte de caso", "Case report"],
  ["Opinión de experto", "Expert opinion"],
  ["Preprint o no claro", "Preprint or unclear"],
  ["Protocolo o evidencia no completada", "Protocol or incomplete evidence"],
  ["Excelente", "Excellent"],
  ["Muy alta", "Very high"],
  ["Alta", "High"],
  ["Moderada", "Moderate"],
  ["Baja", "Low"],
  ["No confirmado", "Not confirmed"],
  ["Tema clínico central: condición + ejercicio", "Direct clinical focus: condition + exercise"],
  ["Título coincide con condición e intervención", "Title matches both the condition and intervention"],
  ["Evalúa efectividad clínica directa", "Evaluates direct clinical effectiveness"],
  ["Compara múltiples intervenciones de ejercicio", "Compares multiple exercise interventions"],
  ["El título responde directamente la pregunta clínica", "The title directly addresses the clinical question"],
  ["Resumen con resultados clínicos relevantes", "Abstract reports clinically relevant outcomes"],
  ["Tema secundario frente a efectividad clínica directa", "Secondary topic relative to direct clinical effectiveness"],
  ["Incluye tema secundario", "Includes a secondary topic"],
  ["Protocolo: evidencia aún no completada", "Protocol: outcome evidence is not yet complete"],
  ["Intervención combinada/no principalmente fisioterapéutica", "Combined intervention or not primarily physiotherapy-based"],
  ["Población menos directa para búsqueda en adultos", "Population is less directly applicable to an adult-focused search"],
  ["Población específica: adultos mayores", "Population is specific to older adults"],
  ["El título se centra en una condición clínica diferente", "The title focuses on a different clinical condition"],
  ["Relevante para fisioterapia/rehabilitación", "Relevant to physiotherapy/rehabilitation"],
  ["Publicación reciente", "Recent publication"],
  ["Tiene resumen disponible", "Abstract available"],
  ["Metadata limitada: sin resumen", "Limited metadata: no abstract"],
  ["Acceso abierto", "Open access"],
  ["Coincide con la condición", "Matches the condition"],
  ["Coincide con la intervención", "Matches the intervention"],
  ["Coincide con la población", "Matches the population"],
  ["resumen disponible", "abstract available"],
  ["metadata limitada: sin resumen", "limited metadata: no abstract"],
  ["incluye ensayos aleatorizados", "includes randomized trials"],
  ["PEDro score no confirmado todavía", "PEDro score not yet confirmed"],
  ["reporta evaluación de riesgo de sesgo/calidad", "reports risk-of-bias or methodological-quality assessment"],
  ["reporta certeza/calidad de evidencia", "reports evidence certainty or quality"],
  ["protocolo/registro reportado", "protocol or registration reported"],
  ["búsqueda en bases científicas", "searched scientific databases"],
  ["reporta estimaciones cuantitativas", "reports quantitative effect estimates"],
  ["limitaciones metodológicas reportadas", "reported methodological limitations"],
  ["posible protocolo o evidencia no completada", "possible protocol or incomplete evidence"],
  ["foco principal fisioterapéutico", "primary focus is physiotherapy"],
  ["título centrado en intervención fisioterapéutica", "title focuses on a physiotherapy intervention"],
  ["revista/fuente afín a fisioterapia", "journal or source is closely aligned with physiotherapy"],
  ["intervención aplicable en fisioterapia", "intervention is applicable in physiotherapy"],
  ["foco principal no fisioterapéutico", "primary focus is not physiotherapy"],
  ["outcomes clínicos útiles", "clinically useful outcomes"],
  ["aporta información de dosis/progresión", "provides dosage or progression information"],
  ["considera adherencia/seguridad/factibilidad", "addresses adherence, safety, or feasibility"],
  ["población clínica identificable", "clearly identifiable clinical population"],
  ["puede tener foco médico complementario", "may include a complementary medical focus"],
  ["evidencia reciente", "recent evidence"],
  ["evidencia relativamente reciente", "relatively recent evidence"],
  ["evidencia antigua; revisar si existe actualización", "older evidence; check for a newer update"],
  ["año no disponible", "publication year unavailable"],
  ["calificación intrínseca del artículo; no depende de la pregunta del usuario", "intrinsic study-quality estimate; independent of the user's question"],
  ["estimación automática; no reemplaza lectura crítica completa", "automated estimate; does not replace full critical appraisal"],
  ["coincide con la condición consultada", "matches the condition in the question"],
  ["coincide con la intervención consultada o sus sinónimos", "matches the intervention or a recognized synonym"],
  ["el título responde directamente la pregunta", "the title directly addresses the question"],
  ["coincide con la población", "matches the population"],
  ["población no coincide claramente con la pregunta", "population does not clearly match the question"],
  ["coincide con el outcome consultado", "matches the outcome in the question"],
  ["incluye outcomes clínicos relacionados", "includes related clinical outcomes"],
  ["foco compatible con fisioterapia/rehabilitación", "focus is compatible with physiotherapy/rehabilitation"],
  ["foco principal menos directo para una pregunta de ejercicio/rehabilitación", "primary focus is less direct for an exercise or rehabilitation question"],
]);

function localizeAtomic(value, language) {
  const text = String(value || "").trim();
  if (!text || language !== "en") return value;
  if (ES_TO_EN.has(text)) return ES_TO_EN.get(text);

  let match = text.match(/^Nivel de evidencia:\s*(.+)$/i);
  if (match) {
    return `Evidence level: ${ES_TO_EN.get(match[1]) || match[1]}`;
  }

  match = text.match(/^Fuente preferente:\s*(.+)$/i);
  if (match) return `Preferred source: ${match[1]}`;

  match = text.match(/^fuente preferente:\s*(.+)$/i);
  if (match) return `preferred source: ${match[1]}`;

  match = text.match(/^PEDro score:\s*(\d+(?:\.\d+)?)\/10\s*\((.+)\)$/i);
  if (match) {
    return `PEDro score: ${match[1]}/10 (${ES_TO_EN.get(match[2]) || match[2]})`;
  }

  return value;
}

function localizeStableText(value, language) {
  if (typeof value !== "string" || language !== "en") return value;

  for (const separator of ["; ", " · "]) {
    if (!value.includes(separator)) continue;
    return value
      .split(separator)
      .map((part) => localizeAtomic(part, language))
      .join(separator);
  }

  return localizeAtomic(value, language);
}

function localizeArray(values, language) {
  if (!Array.isArray(values)) return values;
  return values.map((value) => localizeStableText(value, language));
}

function localizeResearchArticle(article = {}, language = "es") {
  if (language !== "en") return article;

  return {
    ...article,
    // The frontend still reads a few legacy *_es fields. For presentation only,
    // keep those compatibility fields aligned with the selected UI language.
    evidence_level_label_es:
      article.evidence_level_label_en ||
      localizeStableText(article.evidence_level_label_es, language),
    guideline_scope_label_es:
      article.guideline_scope_label_en || article.guideline_scope_label_es,
    guideline_scope_note_es:
      article.guideline_scope_note_en || article.guideline_scope_note_es,
    ranking_reason: localizeStableText(article.ranking_reason, language),
    openphysio_priority_label: localizeStableText(
      article.openphysio_priority_label,
      language
    ),
    pedro_score_label: localizeStableText(article.pedro_score_label, language),
    pedro_explanation: localizeStableText(article.pedro_explanation, language),
    appraisal_flags: localizeArray(article.appraisal_flags, language),
    caution_flags: localizeArray(article.caution_flags, language),
    query_relevance_flags: localizeArray(
      article.query_relevance_flags,
      language
    ),
    query_relevance_limitations: localizeArray(
      article.query_relevance_limitations,
      language
    ),
  };
}

module.exports = {
  localizeResearchArticle,
  localizeStableText,
};
