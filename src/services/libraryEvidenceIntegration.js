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

function combineEvidenceWithLibrary(externalArticles = [], libraryGuides = []) {
  const result = [];
  const seen = new Set();

  for (const article of [...libraryGuides, ...externalArticles]) {
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

  return {
    ...article,
    preferred_source_tier: 120,
    preferred_source_key: "library_jospt_guideline",
    preferred_source_label_es: "Guía JOSPT de la Biblioteca",
    preferred_source_label_en: "JOSPT guide from the Library",
    guideline_applicability: applicability,
    guideline_scope_label_es: direct
      ? "Aplicación directa a la consulta"
      : "Marco clínico relacionado por región",
    guideline_scope_label_en: direct
      ? "Directly applicable to the query"
      : "Regional clinical framework",
    guideline_scope_note_es: direct
      ? "La guía coincide con la condición y la región consultadas."
      : "La guía se recomienda como marco inicial para esta región; la decisión clínica específica debe complementarse con los artículos que responden directamente la pregunta.",
    guideline_scope_note_en: direct
      ? "The guide matches the queried condition and body region."
      : "The guide is recommended as an initial framework for this body region; condition-specific decisions require complementary evidence.",
    query_relevance_score: direct
      ? Math.max(90, Number(article.query_relevance_score || 0))
      : Math.min(62, Number(article.query_relevance_score || 58)),
    reading_priority_score: direct
      ? Math.max(96, Number(article.reading_priority_score || 0))
      : Math.max(86, Number(article.reading_priority_score || 0)),
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

  return {
    id: resource.id,
    slug: resource.slug,
    title: resource.title || article.title,
    journal: resource.journal_name || article.journal,
    year: resource.publication_year || article.year,
    applicability: resource.applicability,
    applicability_label:
      resource.applicability === "direct"
        ? "Aplicación directa"
        : "Marco clínico por región",
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
  combineEvidenceWithLibrary,
  restoreLibraryGuideScope,
  prioritizeLibraryGuides,
  getEvidenceBasisIncludingLibrary,
  getLibraryRecommendations,
  toLibraryRecommendation,
  appendLibraryStudyLinks,
};
