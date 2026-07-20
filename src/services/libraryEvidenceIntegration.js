const { getEvidenceBasis } = require("./sourcePriority");

function normalizeTitle(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDoi(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")
    .replace(/^doi:\s*/, "")
    .replace(/[\s.,;:]+$/, "");
}

function findExactLibraryGuideMatch(article = {}, libraryGuides = []) {
  const articleDoi = normalizeDoi(article.doi);
  const articleTitle = normalizeTitle(article.title);

  for (const guide of Array.isArray(libraryGuides) ? libraryGuides : []) {
    if (!guide?.library_resource) continue;

    const guideDoi = normalizeDoi(guide.doi);
    if (articleDoi && guideDoi && articleDoi === guideDoi) {
      return { guide, matchedBy: "doi" };
    }

    const guideTitles = [guide.title, guide.library_resource.title]
      .map(normalizeTitle)
      .filter(Boolean);
    if (articleTitle && guideTitles.includes(articleTitle)) {
      return { guide, matchedBy: "title" };
    }
  }

  return null;
}

function attachLibraryResourcesToCitations(articles = [], libraryGuides = []) {
  return (Array.isArray(articles) ? articles : []).map((article) => {
    if (!article || article.library_resource) return article;

    const match = findExactLibraryGuideMatch(article, libraryGuides);
    if (!match) return article;

    return {
      ...article,
      library_resource: { ...match.guide.library_resource },
      library_link_match: {
        kind: "exact_library_guide",
        matched_by: match.matchedBy,
      },
    };
  });
}

function combineEvidenceWithLibrary(externalArticles = [], libraryGuides = []) {
  const result = [];
  const seen = new Set();
  const freshExternalArticles = externalArticles.filter(
    (article) => !article.library_resource
  );

  for (const article of [...libraryGuides, ...freshExternalArticles]) {
    const key =
      article.library_resource?.slug ||
      article.doi ||
      article.pmid ||
      normalizeTitle(article.title);
    if (!key || seen.has(String(key).toLowerCase())) continue;
    seen.add(String(key).toLowerCase());
    result.push(article);
  }

  return result;
}

function restoreLibraryGuideScope(article = {}) {
  const resource = article.library_resource;
  if (!resource) return article;

  const applicability = resource.applicability || "regional_framework";
  const direct = applicability === "direct";
  const componentFramework = applicability === "component_framework";
  const originalAbstract = String(article.abstract || "").trim();
  const scopePrefix = direct
    ? "ALCANCE DE LA GUÍA: coincide directamente con la condición y la región consultadas."
    : componentFramework
      ? "ALCANCE DE LA GUÍA: se utiliza como marco clínico relacionado para el componente cervical con cefalea. No sustituye la evidencia específica de cefalea cervicogénica."
      : "ALCANCE DE LA GUÍA: se utiliza únicamente como marco clínico de la misma región corporal. No generalices recomendaciones específicas de otra lesión o diagnóstico a la consulta actual; completa la decisión con los estudios directamente relacionados.";

  const defaultLabelEs = direct
    ? "Aplicación directa a la consulta"
    : componentFramework
      ? "Marco clínico relacionado para dolor cervical con cefalea"
      : "Marco clínico relacionado por región";
  const defaultLabelEn = direct
    ? "Directly applicable to the query"
    : componentFramework
      ? "Related clinical framework for neck pain with headache"
      : "Regional clinical framework";
  const defaultNoteEs = direct
    ? "La guía coincide con la condición y la región consultadas."
    : componentFramework
      ? "La guía orienta la clasificación y el manejo del dolor cervical con cefalea, pero no sustituye la evidencia específica de cefalea cervicogénica."
      : "La guía se recomienda como marco inicial para esta región; la decisión clínica específica debe complementarse con los artículos que responden directamente la pregunta.";
  const defaultNoteEn = direct
    ? "The guide matches the queried condition and body region."
    : componentFramework
      ? "The guide supports classification and management of neck pain with headache, but it does not replace condition-specific cervicogenic headache evidence."
      : "The guide is recommended as an initial framework for this body region; condition-specific decisions require complementary evidence.";

  const existingRelevance = Number(article.query_relevance_score || 0);
  const existingPriority = Number(article.reading_priority_score || 0);

  return {
    ...article,
    abstract: `${scopePrefix} ${originalAbstract}`.trim(),
    preferred_source_tier: 120,
    preferred_source_key: "library_jospt_guideline",
    preferred_source_label_es: "Guía JOSPT de la Biblioteca",
    preferred_source_label_en: "JOSPT guide from the Library",
    guideline_applicability: applicability,
    guideline_scope_label_es: article.guideline_scope_label_es || defaultLabelEs,
    guideline_scope_label_en: article.guideline_scope_label_en || defaultLabelEn,
    guideline_scope_note_es: article.guideline_scope_note_es || defaultNoteEs,
    guideline_scope_note_en: article.guideline_scope_note_en || defaultNoteEn,
    query_relevance_score: direct
      ? Math.max(90, existingRelevance)
      : componentFramework
        ? Math.min(82, Math.max(72, existingRelevance))
        : Math.min(62, existingRelevance || 58),
    reading_priority_score: direct
      ? Math.max(96, existingPriority)
      : componentFramework
        ? Math.min(88, Math.max(84, existingPriority))
        : Math.max(86, existingPriority),
  };
}

function prioritizeLibraryGuides(articles = []) {
  return articles
    .map((article, index) => ({
      article: restoreLibraryGuideScope(article),
      index,
    }))
    .sort((left, right) => {
      const libraryDifference =
        Number(Boolean(right.article.library_resource)) -
        Number(Boolean(left.article.library_resource));
      if (libraryDifference !== 0) return libraryDifference;

      if (left.article.library_resource && right.article.library_resource) {
        const directDifference =
          Number(right.article.guideline_applicability === "direct") -
          Number(left.article.guideline_applicability === "direct");
        if (directDifference !== 0) return directDifference;
      }

      return left.index - right.index;
    })
    .map((item) => item.article);
}

function getEvidenceBasisIncludingLibrary(articles = [], language = "es") {
  const libraryIndex = articles.findIndex((article) => article.library_resource);
  if (libraryIndex < 0) return getEvidenceBasis(articles, language);

  const guide = articles[libraryIndex];
  const direct = guide.guideline_applicability === "direct";
  const componentFramework =
    guide.guideline_applicability === "component_framework";
  const title = guide.title || guide.library_resource?.title;
  const isEnglish = language === "en";

  return {
    key: "library_jospt_guideline",
    available: true,
    label: isEnglish
      ? "JOSPT clinical guide from the OpenPhysio Library"
      : "Guía clínica JOSPT de la Biblioteca OpenPhysioAI",
    explanation: direct
      ? isEnglish
        ? "This Library guide directly matches the queried condition and is used as the initial clinical framework."
        : "Esta guía de la Biblioteca coincide directamente con la condición consultada y se utiliza como marco clínico inicial."
      : componentFramework
        ? isEnglish
          ? "This Library guide is used as a related framework for neck pain with headache; condition-specific cervicogenic headache evidence completes the answer."
          : "Esta guía de la Biblioteca se utiliza como marco relacionado para dolor cervical con cefalea; la respuesta se completa con evidencia específica de cefalea cervicogénica."
        : isEnglish
          ? "This Library guide is used as a regional clinical framework; the specific question is completed with directly relevant external studies."
          : "Esta guía de la Biblioteca se utiliza como marco clínico de la región; la pregunta específica se completa con estudios externos directamente relevantes.",
    source_indices: [libraryIndex + 1],
    applicability: guide.guideline_applicability || "regional_framework",
    scope_note:
      language === "en"
        ? guide.guideline_scope_note_en || null
        : guide.guideline_scope_note_es || null,
    guide_title: title,
    library_resource: guide.library_resource,
    jospt_guideline_found: true,
    cochrane_found: articles.some((article) =>
      String(`${article.journal || ""} ${article.source_name || ""}`)
        .toLowerCase()
        .includes("cochrane")
    ),
    pubmed_found: articles.some(
      (article) =>
        Boolean(article.pmid) || article.retrieval_source_name === "PubMed"
    ),
  };
}

function toLibraryRecommendation(article = {}) {
  const resource = article.library_resource;
  if (!resource) return null;

  const applicability = resource.applicability;
  const applicabilityLabel =
    applicability === "direct"
      ? "Aplicación directa"
      : applicability === "component_framework"
        ? "Marco clínico relacionado"
        : "Marco clínico por región";

  return {
    id: resource.id,
    slug: resource.slug,
    title: resource.title || article.title,
    journal: resource.journal_name || article.journal,
    year: resource.publication_year || article.year,
    applicability,
    applicability_label: applicabilityLabel,
    scope_note: article.guideline_scope_note_es || null,
    links: resource.links,
  };
}

function getLibraryRecommendations(articles = []) {
  return articles.map(toLibraryRecommendation).filter(Boolean);
}

function appendLibraryStudyLinks(reply = "", recommendations = [], language = "es") {
  const guide = recommendations[0];
  if (!guide?.links) return String(reply || "").trim();

  const isEnglish = language === "en";
  const heading = isEnglish
    ? "**Study this guide in the Library**"
    : "**Estudia esta guía en la Biblioteca**";
  const intro = isEnglish
    ? "Review the integrated summary, listen to the audio, or use the infographics."
    : "Revisa el resumen integrado, escucha el audio o estudia con las infografías.";
  const links = isEnglish
    ? `[Read summary](${guide.links.report}) · [Listen to audio](${guide.links.audio}) · [View infographics](${guide.links.infographics})`
    : `[Leer resumen](${guide.links.report}) · [Escuchar audio](${guide.links.audio}) · [Ver infografías](${guide.links.infographics})`;

  return `${String(reply || "").trim()}\n\n${heading}\n${guide.title}\n\n${intro}\n\n${links}`;
}

module.exports = {
  attachLibraryResourcesToCitations,
  findExactLibraryGuideMatch,
  combineEvidenceWithLibrary,
  restoreLibraryGuideScope,
  prioritizeLibraryGuides,
  getEvidenceBasisIncludingLibrary,
  getLibraryRecommendations,
  toLibraryRecommendation,
  appendLibraryStudyLinks,
};
