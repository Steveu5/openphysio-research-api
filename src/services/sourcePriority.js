const { getConditionMatch } = require("./conditionConcepts");

function normalize(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function articleSourceText(article = {}) {
  return normalize(
    [
      article.source_name,
      article.retrieval_source_name,
      article.trusted_source_label,
      article.professional_source_label,
      article.journal,
      article.title,
      article.study_type,
      article.authors_text,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function isIncompleteProtocol(article = {}) {
  const evidenceLevel = String(article.evidence_level || "").toLowerCase();
  const studyType = normalize(article.study_type);
  const title = normalize(article.title);
  const abstract = normalize(article.abstract);

  if (evidenceLevel === "preprint_or_unclear") return true;
  if (studyType === "protocol" || studyType.includes("protocol article")) {
    return true;
  }

  const protocolSignal =
    title.includes("study protocol") ||
    title.includes("review protocol") ||
    title.endsWith(" protocol") ||
    abstract.includes("this is the protocol") ||
    abstract.includes("this protocol describes") ||
    abstract.includes("we describe the protocol");
  const completionSignal =
    abstract.includes("we included") ||
    abstract.includes("were included") ||
    abstract.includes("results showed") ||
    abstract.includes("we found") ||
    abstract.includes("meta analysis was performed");

  return protocolSignal && !completionSignal;
}

function isGuideline(article = {}) {
  if (isIncompleteProtocol(article)) return false;

  const evidenceLevel = String(article.evidence_level || "").toLowerCase();
  const studyType = normalize(article.study_type);
  const title = normalize(article.title);
  const secondaryTitleSignals = [
    "adherence",
    "implementation",
    "appraisal",
    "review of guidelines",
    "systematic review of guidelines",
    "comparison of guidelines",
    "survey",
    "knowledge",
    "attitudes",
    "uptake",
  ];
  const looksSecondary = secondaryTitleSignals.some((term) =>
    title.includes(term)
  );

  if (evidenceLevel === "clinical_practice_guideline") return true;
  if (Number(article.evidence_level_rank || 0) >= 10 && !looksSecondary) {
    return true;
  }
  if (
    (studyType.includes("practice guideline") ||
      studyType === "guideline" ||
      studyType.includes("clinical practice guideline")) &&
    !studyType.includes("review")
  ) {
    return true;
  }

  return (
    !looksSecondary &&
    (title.includes("clinical practice guideline") ||
      title.includes("practice guideline") ||
      title.includes("guideline revision"))
  );
}

function isJospt(article = {}) {
  const text = articleSourceText(article);
  return (
    text.includes("journal of orthopaedic and sports physical therapy") ||
    text.includes("journal of orthopedic and sports physical therapy") ||
    text.includes("j orthop sports phys ther") ||
    /\bjospt\b/.test(text)
  );
}

function isAoptOrApta(article = {}) {
  const text = articleSourceText(article);
  return (
    text.includes("academy of orthopaedic physical therapy") ||
    text.includes("orthopaedic section") ||
    text.includes("american physical therapy association") ||
    /\bapta\b/.test(text) ||
    /\baopt\b/.test(text)
  );
}

function isCochrane(article = {}) {
  const text = articleSourceText(article);
  return (
    text.includes("cochrane database of systematic reviews") ||
    text.includes("cochrane database syst rev") ||
    /\bcochrane\b/.test(text)
  );
}

function wasRetrievedFromPubMed(article = {}) {
  const direct = normalize(article.retrieval_source_name);
  const source = normalize(article.source_name);
  const metadata = normalize(JSON.stringify(article.raw_metadata || {}));

  return (
    direct.includes("pubmed") ||
    source.includes("pubmed") ||
    metadata.includes("pubmed e utilities") ||
    Boolean(article.pmid)
  );
}

function isNeckIntent(intent = {}) {
  const text = normalize(
    [
      intent.condition,
      intent.body_region,
      intent.normalized_query,
      ...(Array.isArray(intent.search_terms) ? intent.search_terms : []),
    ]
      .filter(Boolean)
      .join(" ")
  );

  return (
    text.includes("neck") ||
    text.includes("cervical") ||
    text.includes("cervicogenic") ||
    text.includes("cuello") ||
    text.includes("cervicalgia")
  );
}

function isNeckGuideline(article = {}) {
  const text = normalize(
    [article.title, article.abstract, article.journal]
      .filter(Boolean)
      .join(" ")
  );

  return (
    text.includes("neck pain") ||
    text.includes("cervical pain") ||
    text.includes("cervical spine") ||
    text.includes("cervicogenic") ||
    text.includes("neck pain revision")
  );
}

function isRelatedJosptGuidelineForIntent(article = {}, intent = {}) {
  if (!isJospt(article) || !isGuideline(article)) return false;
  if (!isNeckIntent(intent) || !isNeckGuideline(article)) return false;

  return !getConditionMatch(article, intent).matches;
}

function annotateGuidelineApplicability(article = {}, intent = {}) {
  if (!isGuideline(article)) return article;

  const conditionMatch = getConditionMatch(article, intent);
  if (conditionMatch.matches) {
    return {
      ...article,
      guideline_applicability: "direct",
      guideline_scope_label_es: "Aplicación directa a la condición consultada",
      guideline_scope_label_en: "Directly applicable to the queried condition",
      guideline_scope_note_es:
        "La guía coincide directamente con la condición clínica consultada.",
      guideline_scope_note_en:
        "The guideline directly matches the queried clinical condition.",
    };
  }

  if (isRelatedJosptGuidelineForIntent(article, intent)) {
    return {
      ...article,
      guideline_applicability: "related_cervical_component",
      guideline_scope_label_es:
        "Aplicable al componente cervical de la consulta",
      guideline_scope_label_en:
        "Applicable to the cervical component of the query",
      guideline_scope_note_es:
        "Se prioriza como marco para evaluación e intervención del dolor cervical, pero no constituye por sí sola evidencia directa sobre cefalea cervicogénica.",
      guideline_scope_note_en:
        "It is prioritized as a framework for neck pain assessment and intervention, but it is not by itself direct evidence for cervicogenic headache.",
    };
  }

  return article;
}

function getPreferredSourcePriority(article = {}) {
  if (isIncompleteProtocol(article)) {
    return {
      tier: 40,
      key: "incomplete_protocol",
      label_es: "Protocolo o evidencia no completada",
      label_en: "Protocol or incomplete evidence",
      reason_es:
        "El registro describe un protocolo sin resultados clínicos completados y no puede ser la base principal.",
      reason_en:
        "The record describes a protocol without completed clinical results and cannot be the primary evidence basis.",
    };
  }

  const guideline = isGuideline(article);
  const jospt = isJospt(article);
  const aopt = isAoptOrApta(article);
  const cochrane = isCochrane(article);
  const pubmed = wasRetrievedFromPubMed(article);

  if (guideline && jospt) {
    return {
      tier: 100,
      key: "jospt_guideline",
      label_es: "Guía clínica JOSPT/AOPT",
      label_en: "JOSPT/AOPT clinical practice guideline",
      reason_es:
        "Guía JOSPT/AOPT priorizada como base principal para el componente clínico al que resulta aplicable.",
      reason_en:
        "JOSPT/AOPT guideline prioritized as the primary basis for the clinical component to which it applies.",
    };
  }

  if (guideline && aopt) {
    return {
      tier: 95,
      key: "apta_aopt_guideline",
      label_es: "Guía clínica APTA/AOPT",
      label_en: "APTA/AOPT clinical practice guideline",
      reason_es: "Guía profesional APTA/AOPT directamente relacionada.",
      reason_en: "Directly relevant APTA/AOPT professional guideline.",
    };
  }

  if (guideline) {
    return {
      tier: 90,
      key: "other_guideline",
      label_es: "Guía clínica profesional",
      label_en: "Professional clinical practice guideline",
      reason_es: "Guía clínica directamente relacionada con la pregunta.",
      reason_en: "Clinical practice guideline directly related to the question.",
    };
  }

  if (cochrane) {
    return {
      tier: 80,
      key: "cochrane_review",
      label_es: "Revisión Cochrane",
      label_en: "Cochrane review",
      reason_es: "Revisión Cochrane directamente relacionada.",
      reason_en: "Directly relevant Cochrane review.",
    };
  }

  if (pubmed) {
    return {
      tier: 70,
      key: "pubmed_evidence",
      label_es: "Evidencia recuperada en PubMed",
      label_en: "Evidence retrieved from PubMed",
      reason_es:
        "Artículo clínico relevante recuperado y verificado mediante PubMed.",
      reason_en:
        "Relevant clinical article retrieved and verified through PubMed.",
    };
  }

  return {
    tier: 50,
    key: "other_evidence",
    label_es: "Evidencia complementaria",
    label_en: "Complementary evidence",
    reason_es:
      "Evidencia complementaria recuperada de otras fuentes académicas.",
    reason_en:
      "Complementary evidence retrieved from other academic sources.",
  };
}

function annotateSourcePriority(article = {}, intent = null) {
  const scopedArticle = intent
    ? annotateGuidelineApplicability(article, intent)
    : article;
  const priority = getPreferredSourcePriority(scopedArticle);

  return {
    ...scopedArticle,
    preferred_source_tier: priority.tier,
    preferred_source_key: priority.key,
    preferred_source_label_es: priority.label_es,
    preferred_source_label_en: priority.label_en,
    preferred_source_reason_es: priority.reason_es,
    preferred_source_reason_en: priority.reason_en,
  };
}

function getEvidenceBasis(articles = [], language = "es") {
  const annotated = articles.map((article, index) => ({
    article,
    index,
    priority: getPreferredSourcePriority(article),
  }));

  const ranked = annotated
    .filter((item) => item.priority.tier >= 70)
    .sort((left, right) => {
      const tierDifference = right.priority.tier - left.priority.tier;
      if (tierDifference !== 0) return tierDifference;
      return (
        Number(right.article.reading_priority_score || 0) -
        Number(left.article.reading_priority_score || 0)
      );
    });

  const primary = ranked[0] || null;
  if (!primary) {
    return {
      key: "no_preferred_basis",
      available: false,
      label:
        language === "en"
          ? "No directly applicable completed preferred guideline or review was found"
          : "No se encontró una guía o revisión preferente completada y directamente aplicable",
      explanation:
        language === "en"
          ? "The response uses the best available relevant evidence and should not be presented as based on JOSPT."
          : "La respuesta utiliza la mejor evidencia relevante disponible y no debe presentarse como basada en JOSPT.",
      source_indices: [],
      applicability: null,
      scope_note: null,
      jospt_guideline_found: false,
      cochrane_found: annotated.some(
        (item) => item.priority.key === "cochrane_review"
      ),
      pubmed_found: annotated.some(
        (item) =>
          item.priority.key === "pubmed_evidence" ||
          wasRetrievedFromPubMed(item.article)
      ),
    };
  }

  const sourceIndices = ranked
    .filter((item) => item.priority.key === primary.priority.key)
    .slice(0, 3)
    .map((item) => item.index + 1);

  const relatedCervicalGuideline =
    primary.priority.key === "jospt_guideline" &&
    primary.article.guideline_applicability ===
      "related_cervical_component";

  const label = relatedCervicalGuideline
    ? language === "en"
      ? "JOSPT/AOPT guideline for the cervical component"
      : "Guía JOSPT/AOPT para el componente cervical"
    : language === "en"
      ? primary.priority.label_en
      : primary.priority.label_es;
  const explanation = relatedCervicalGuideline
    ? language === "en"
      ? "It is used as the primary framework for neck pain assessment and intervention, while headache-specific conclusions require complementary evidence."
      : "Se utiliza como marco principal para la evaluación e intervención del dolor cervical; las conclusiones específicas sobre cefalea requieren evidencia complementaria."
    : language === "en"
      ? primary.priority.reason_en
      : primary.priority.reason_es;
  const scopeNote = relatedCervicalGuideline
    ? language === "en"
      ? primary.article.guideline_scope_note_en
      : primary.article.guideline_scope_note_es
    : null;

  return {
    key: relatedCervicalGuideline
      ? "jospt_related_cervical_guideline"
      : primary.priority.key,
    available: true,
    label,
    explanation,
    source_indices: sourceIndices,
    applicability:
      primary.article.guideline_applicability || "direct",
    scope_note: scopeNote,
    jospt_guideline_found: ranked.some(
      (item) => item.priority.key === "jospt_guideline"
    ),
    cochrane_found: ranked.some(
      (item) => item.priority.key === "cochrane_review"
    ),
    pubmed_found: annotated.some((item) =>
      wasRetrievedFromPubMed(item.article)
    ),
  };
}

function formatEvidenceBasisLine(basis = {}, language = "es") {
  const citations =
    Array.isArray(basis.source_indices) && basis.source_indices.length
      ? ` [${basis.source_indices.join(",")}]`
      : "";

  if (!basis.available) {
    return language === "en"
      ? `Evidence basis: ${basis.label}. ${basis.explanation}`
      : `Base de evidencia: ${basis.label}. ${basis.explanation}`;
  }

  const mainLine =
    language === "en"
      ? `Primary evidence basis: ${basis.label}.${citations}`
      : `Base principal de evidencia: ${basis.label}.${citations}`;

  return basis.scope_note
    ? `${mainLine} ${basis.scope_note}`
    : mainLine;
}

function injectEvidenceBasisIntoReply(
  reply = "",
  basis = {},
  language = "es",
  { markdown = false } = {}
) {
  const line = formatEvidenceBasisLine(basis, language);
  const text = String(reply || "").trim();
  if (!text) return line;

  const lines = text.split("\n");
  const insertion = markdown ? `**${line}**` : line;
  lines.splice(Math.min(1, lines.length), 0, insertion);
  return lines.join("\n");
}

module.exports = {
  isIncompleteProtocol,
  isGuideline,
  isJospt,
  isAoptOrApta,
  isCochrane,
  wasRetrievedFromPubMed,
  isNeckIntent,
  isNeckGuideline,
  isRelatedJosptGuidelineForIntent,
  annotateGuidelineApplicability,
  getPreferredSourcePriority,
  annotateSourcePriority,
  getEvidenceBasis,
  formatEvidenceBasisLine,
  injectEvidenceBasisIntoReply,
};
