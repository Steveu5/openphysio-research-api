const { getSupabaseAdmin } = require("./supabase");

function normalize(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getPreviewEmails() {
  return new Set(
    String(process.env.LIBRARY_PREVIEW_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

function canUsePreviewCatalog(userEmail = "") {
  return getPreviewEmails().has(String(userEmail || "").trim().toLowerCase());
}

const BODY_REGIONS = [
  {
    id: "cervical",
    queryTerms: ["neck", "cervical", "cuello", "cervicalgia", "cervicogenic", "whiplash", "latigazo"],
    catalogTerms: ["neck", "cervical", "cervicogenic", "whiplash"],
    indexingText: "neck pain cervical pain dolor de cuello dolor cervical cervicalgia",
  },
  {
    id: "lumbar",
    queryTerms: ["lumbar", "low back", "lumbalgia", "espalda baja", "dolor de espalda", "sciatica", "ciatica"],
    catalogTerms: ["low back", "lumbar", "lumbosacral", "sciatica"],
    indexingText: "low back pain lumbar pain dolor lumbar lumbalgia espalda baja",
  },
  {
    id: "shoulder",
    queryTerms: ["shoulder", "hombro", "rotator cuff", "manguito rotador", "subacromial"],
    catalogTerms: ["shoulder", "rotator cuff", "subacromial", "adhesive capsulitis"],
    indexingText: "shoulder pain dolor de hombro rotator cuff manguito rotador",
  },
  {
    id: "elbow",
    queryTerms: ["elbow", "codo", "epicondyl", "tennis elbow"],
    catalogTerms: ["elbow", "epicondyl", "tennis elbow"],
    indexingText: "elbow pain dolor de codo lateral epicondylalgia",
  },
  {
    id: "hip",
    queryTerms: ["hip", "cadera", "groin", "ingle", "femoroacetabular", "fais"],
    catalogTerms: ["hip", "groin", "femoroacetabular", "fais"],
    indexingText: "hip pain groin pain dolor de cadera dolor de ingle",
  },
  {
    id: "knee",
    queryTerms: ["knee", "rodilla", "patellofemoral", "patelofemoral", "acl", "lca", "meniscus", "menisco"],
    catalogTerms: ["knee", "patellofemoral", "anterior cruciate", "acl", "meniscus", "meniscal", "knee ligament"],
    indexingText: "knee pain dolor de rodilla anterior knee pain patellofemoral pain",
  },
  {
    id: "ankle_foot",
    queryTerms: ["ankle", "tobillo", "foot", "pie", "achilles", "aquiles", "ankle sprain", "esguince"],
    catalogTerms: ["ankle", "foot", "achilles", "lateral ankle ligament", "ankle stability", "ankle sprain"],
    indexingText: "ankle pain ankle sprain chronic ankle instability foot pain achilles pain dolor de tobillo esguince de tobillo dolor de pie",
  },
];

const SPECIFIC_CONDITIONS = [
  {
    id: "neck_pain",
    queryTerms: ["neck pain", "dolor cervical", "dolor de cuello", "cervicalgia"],
    catalogTerms: ["neck pain", "cervical pain", "neck pain revision"],
  },
  {
    id: "low_back_pain",
    queryTerms: ["low back pain", "dolor lumbar", "lumbalgia", "espalda baja"],
    catalogTerms: ["low back pain", "lumbar pain", "management of acute and chronic low back pain"],
  },
  {
    id: "acl",
    queryTerms: ["acl", "lca", "anterior cruciate", "ligamento cruzado anterior"],
    catalogTerms: ["acl", "anterior cruciate", "cruciate ligament", "knee ligament sprain", "knee stability and movement coordination impairments"],
  },
  {
    id: "meniscus",
    queryTerms: ["meniscus", "menisco", "meniscal"],
    catalogTerms: ["meniscus", "meniscal", "meniscal and articular cartilage lesions"],
  },
  {
    id: "patellofemoral",
    queryTerms: ["patellofemoral", "patelofemoral", "dolor anterior de rodilla"],
    catalogTerms: ["patellofemoral", "anterior knee pain"],
  },
  {
    id: "ankle_sprain",
    queryTerms: ["ankle sprain", "esguince de tobillo", "inestabilidad de tobillo", "chronic ankle instability"],
    catalogTerms: ["ankle sprain", "ankle stability", "lateral ankle ligament", "chronic ankle instability"],
  },
  {
    id: "achilles",
    queryTerms: ["achilles", "aquiles", "tendinopatia aquilea", "tendinopathy"],
    catalogTerms: ["achilles", "tendinopathy"],
  },
  {
    id: "rotator_cuff",
    queryTerms: ["rotator cuff", "manguito rotador", "subacromial"],
    catalogTerms: ["rotator cuff", "subacromial"],
  },
];

function includesAny(text, terms = []) {
  const normalizedText = normalize(text);
  return terms.some((term) => normalizedText.includes(normalize(term)));
}

function getIntentText(query = "", intent = {}) {
  return normalize(
    [
      query,
      intent.condition,
      intent.body_region,
      intent.normalized_query,
      intent.intervention,
      ...(Array.isArray(intent.search_terms) ? intent.search_terms : []),
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function detectRegions(query = "", intent = {}) {
  const text = getIntentText(query, intent);
  return BODY_REGIONS.filter((region) => includesAny(text, region.queryTerms));
}

function detectSpecificConditions(query = "", intent = {}) {
  const text = getIntentText(query, intent);
  return SPECIFIC_CONDITIONS.filter((condition) => includesAny(text, condition.queryTerms));
}

function isGuidelineCatalogItem(item = {}) {
  const title = normalize(item.title);
  const category = normalize(item.category);

  return (
    title.includes("clinical practice guideline") ||
    title.includes("practice guideline") ||
    title.includes("guideline revision") ||
    title.includes("linked to the international classification") ||
    title.includes("revision 20") ||
    category.includes("clinical practice guideline") ||
    category.includes("practice guideline") ||
    category.includes("guia clinica") ||
    category.includes("guia de practica clinica")
  );
}

function scoreCatalogItem(item, regions, specificConditions) {
  const text = normalize([item.title, item.category, item.journal_name].filter(Boolean).join(" "));
  let score = 0;
  const matchedRegions = [];
  const matchedConditions = [];

  for (const region of regions) {
    if (includesAny(text, region.catalogTerms)) {
      score += 100;
      matchedRegions.push(region.id);
    }
  }

  for (const condition of specificConditions) {
    if (includesAny(text, condition.catalogTerms)) {
      score += 130;
      matchedConditions.push(condition.id);
    }
  }

  if (text.includes("jospt") || text.includes("j orthop sports phys ther")) score += 45;
  if (text.includes("journal of orthopaedic and sports physical therapy")) score += 45;
  if (text.includes("clinical practice guideline") || text.includes("practice guideline") || text.includes("revision 20")) score += 30;
  if (item.is_complete) score += 10;

  return { score, matchedRegions, matchedConditions };
}

function stripHtml(html = "") {
  return String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadGuideExcerpt(item, language = "es") {
  if (!item.storage_path) return null;

  try {
    const supabase = getSupabaseAdmin();
    const bucket = process.env.LIBRARY_BUCKET || "library-assets";
    const storage = supabase.storage.from(bucket);
    const { data: manifestBlob, error: manifestError } = await storage.download(`${item.storage_path}/manifest.json`);
    if (manifestError || !manifestBlob) return null;

    const manifest = JSON.parse(await manifestBlob.text());
    const preferredLanguage = language === "en" ? "en" : "es";
    const resources = manifest.resources?.[preferredLanguage] || manifest.resources?.en;
    const reportPath = resources?.report;
    if (!reportPath) return null;

    const { data: reportBlob, error: reportError } = await storage.download(`${item.storage_path}/${reportPath}`);
    if (reportError || !reportBlob) return null;

    const text = stripHtml(await reportBlob.text());
    return text ? text.slice(0, 7000) : null;
  } catch (error) {
    console.warn("Library guide excerpt error:", error.message);
    return null;
  }
}

function buildResourceLinks(item) {
  const base = `/library?guide=${encodeURIComponent(item.slug)}`;
  return {
    library: base,
    report: `${base}&resource=report`,
    audio: `${base}&resource=audio`,
    infographics: `${base}&resource=infographics`,
  };
}

function toLinkableGuide(item = {}) {
  const links = buildResourceLinks(item);
  return {
    id: `library:${item.id}`,
    title: item.title,
    doi: item.doi || null,
    library_resource: {
      id: item.id,
      slug: item.slug,
      title: item.title,
      category: item.category || null,
      journal_name: item.journal_name || null,
      publication_year: item.publication_year || null,
      links,
    },
  };
}

function getRegionIndexingText(matchedRegions = []) {
  return BODY_REGIONS.filter((region) => matchedRegions.includes(region.id))
    .map((region) => region.indexingText)
    .join(" ");
}

function toGuideArticle(item, match, excerpt) {
  const direct = match.matchedConditions.length > 0;
  const applicability = direct ? "direct" : "regional_framework";
  const links = buildResourceLinks(item);
  const indexingText = getRegionIndexingText(match.matchedRegions);
  const guideText = excerpt || `Guía clínica disponible en la Biblioteca OpenPhysioAI para orientar la evaluación y el manejo de la región ${match.matchedRegions.join(", ") || "consultada"}.`;

  return {
    id: `library:${item.id}`,
    title: item.title,
    abstract: `${guideText} Términos de indexación regional: ${indexingText}.`,
    authors_text: item.authors || null,
    journal: item.journal_name || "Biblioteca OpenPhysioAI",
    year: item.publication_year || null,
    study_type: "clinical practice guideline",
    evidence_level: "clinical_practice_guideline",
    evidence_level_label_es: "Guía de práctica clínica",
    evidence_level_label_en: "Clinical practice guideline",
    evidence_level_rank: 10,
    source_name: "Biblioteca OpenPhysioAI",
    retrieval_source_name: "OpenPhysio Library",
    source_url: links.report,
    doi: item.doi || null,
    open_access: false,
    is_physiotherapy_relevant: true,
    physiotherapy_relevance_score: 15,
    openphysio_evidence_score: 92,
    query_relevance_score: direct ? 94 : 58,
    reading_priority_score: direct ? 96 : 86,
    preferred_source_tier: 120,
    preferred_source_key: "library_jospt_guideline",
    preferred_source_label_es: "Guía JOSPT de la Biblioteca",
    preferred_source_label_en: "JOSPT guide from the Library",
    guideline_applicability: applicability,
    guideline_scope_label_es: direct ? "Aplicación directa a la consulta" : "Marco clínico relacionado por región",
    guideline_scope_label_en: direct ? "Directly applicable to the query" : "Regional clinical framework",
    guideline_scope_note_es: direct
      ? "La guía coincide con la condición y la región consultadas."
      : "La guía se recomienda como marco inicial para esta región; la decisión clínica específica debe complementarse con los artículos que responden directamente la pregunta.",
    guideline_scope_note_en: direct
      ? "The guide matches the queried condition and body region."
      : "The guide is recommended as an initial framework for this body region; condition-specific decisions require complementary evidence.",
    library_resource: {
      id: item.id,
      slug: item.slug,
      title: item.title,
      category: item.category || null,
      journal_name: item.journal_name || null,
      publication_year: item.publication_year || null,
      applicability,
      matched_regions: match.matchedRegions,
      matched_conditions: match.matchedConditions,
      links,
    },
  };
}

async function getLibraryGuideRecommendations({
  query = "",
  intent = {},
  language = "es",
  limit = 2,
  userEmail = null,
} = {}) {
  const regions = detectRegions(query, intent);
  const specificConditions = detectSpecificConditions(query, intent);
  const supabase = getSupabaseAdmin();
  const previewAllowed = canUsePreviewCatalog(userEmail);
  let catalogQuery = supabase
    .from("library_catalog")
    .select(
      [
        "id",
        "title",
        "slug",
        "category",
        "publication_year",
        "journal_name",
        "authors",
        "doi",
        "storage_path",
        "is_complete",
        "is_published",
        "validation_status",
      ].join(",")
    )
    .eq("validation_status", "ready")
    .not("slug", "is", null);

  if (!previewAllowed) catalogQuery = catalogQuery.eq("is_published", true);

  const { data, error } = await catalogQuery;
  if (error) {
    console.warn("Library guide catalog error:", error.message);
    return {
      guides: [],
      linkableGuides: [],
      diagnostics: {
        regions: regions.map((region) => region.id),
        preview: previewAllowed,
        error: true,
      },
    };
  }

  const catalogGuides = (data || [])
    .filter(isGuidelineCatalogItem)
    .map((item) => ({
      item,
      match: scoreCatalogItem(item, regions, specificConditions),
    }));
  const ranked = catalogGuides
    .filter(({ match }) => match.matchedRegions.length > 0)
    .sort((left, right) => right.match.score - left.match.score)
    .slice(0, Math.max(1, Math.min(Number(limit) || 2, 3)));
  const linkableGuides = catalogGuides.map(({ item }) =>
    toLinkableGuide(item)
  );

  const guides = await Promise.all(
    ranked.map(async ({ item, match }) => {
      const excerpt = await loadGuideExcerpt(item, language);
      return toGuideArticle(item, match, excerpt);
    })
  );

  return {
    guides,
    linkableGuides,
    diagnostics: {
      version: "1.1.0",
      regions: regions.map((region) => region.id),
      specific_conditions: specificConditions.map((condition) => condition.id),
      catalog_candidates: (data || []).length,
      matched_guides: guides.length,
      linkable_guides: linkableGuides.length,
      preview: previewAllowed,
    },
  };
}

module.exports = {
  BODY_REGIONS,
  SPECIFIC_CONDITIONS,
  canUsePreviewCatalog,
  detectRegions,
  detectSpecificConditions,
  isGuidelineCatalogItem,
  scoreCatalogItem,
  stripHtml,
  toLinkableGuide,
  getLibraryGuideRecommendations,
};
