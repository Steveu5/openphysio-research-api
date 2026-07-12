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

const BODY_REGIONS = [
  {
    id: "cervical",
    queryTerms: ["neck", "cervical", "cuello", "cervicalgia", "cervicogenic", "whiplash", "latigazo"],
    catalogTerms: ["neck", "cervical", "cervicogenic", "whiplash"],
  },
  {
    id: "lumbar",
    queryTerms: ["lumbar", "low back", "lumbalgia", "espalda baja", "dolor de espalda", "sciatica", "ciatica"],
    catalogTerms: ["low back", "lumbar", "lumbosacral", "sciatica"],
  },
  {
    id: "shoulder",
    queryTerms: ["shoulder", "hombro", "rotator cuff", "manguito rotador", "subacromial"],
    catalogTerms: ["shoulder", "rotator cuff", "subacromial", "adhesive capsulitis"],
  },
  {
    id: "elbow",
    queryTerms: ["elbow", "codo", "epicondyl", "tennis elbow"],
    catalogTerms: ["elbow", "epicondyl", "tennis elbow"],
  },
  {
    id: "hip",
    queryTerms: ["hip", "cadera", "groin", "ingle", "femoroacetabular", "fais"],
    catalogTerms: ["hip", "groin", "femoroacetabular", "fais"],
  },
  {
    id: "knee",
    queryTerms: ["knee", "rodilla", "patellofemoral", "patelofemoral", "acl", "lca", "meniscus", "menisco"],
    catalogTerms: [
      "knee",
      "patellofemoral",
      "anterior cruciate",
      "acl",
      "meniscus",
      "meniscal",
      "knee ligament",
    ],
  },
  {
    id: "ankle_foot",
    queryTerms: ["ankle", "tobillo", "foot", "pie", "achilles", "aquiles", "ankle sprain", "esguince"],
    catalogTerms: [
      "ankle",
      "foot",
      "achilles",
      "lateral ankle ligament",
      "ankle stability",
      "ankle sprain",
    ],
  },
];

const SPECIFIC_CONDITIONS = [
  {
    id: "neck_pain",
    queryTerms: ["neck pain", "dolor cervical", "dolor de cuello", "cervicalgia"],
    catalogTerms: ["neck pain", "cervical pain"],
  },
  {
    id: "low_back_pain",
    queryTerms: ["low back pain", "dolor lumbar", "lumbalgia", "espalda baja"],
    catalogTerms: ["low back pain", "lumbar pain"],
  },
  {
    id: "acl",
    queryTerms: ["acl", "lca", "anterior cruciate", "ligamento cruzado anterior"],
    catalogTerms: ["acl", "anterior cruciate", "cruciate ligament"],
  },
  {
    id: "meniscus",
    queryTerms: ["meniscus", "menisco", "meniscal"],
    catalogTerms: ["meniscus", "meniscal"],
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
  return SPECIFIC_CONDITIONS.filter((condition) =>
    includesAny(text, condition.queryTerms)
  );
}

function isGuidelineCatalogItem(item = {}) {
  const text = normalize(
    [item.title, item.category, item.journal_name].filter(Boolean).join(" ")
  );

  return (
    text.includes("j orthop sports phys ther") ||
    text.includes("journal of orthopaedic and sports physical therapy") ||
    text.includes("journal of orthopedic and sports physical therapy") ||
    text.includes("jospt") ||
    text.includes("clinical practice guideline") ||
    text.includes("practice guideline") ||
    text.includes("guideline revision") ||
    text.includes("revision 20")
  );
}

function scoreCatalogItem(item, regions, specificConditions) {
  const text = normalize(
    [item.title, item.category, item.journal_name].filter(Boolean).join(" ")
  );
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

  if (text.includes("jospt") || text.includes("j orthop sports phys ther")) {
    score += 45;
  }
  if (text.includes("journal of orthopaedic and sports physical therapy")) {
    score += 45;
  }
  if (
    text.includes("clinical practice guideline") ||
    text.includes("practice guideline") ||
    text.includes("revision 20")
  ) {
    score += 30;
  }
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
    const manifestPath = `${item.storage_path}/manifest.json`;
    const { data: manifestBlob, error: manifestError } = await storage.download(
      manifestPath
    );
    if (manifestError || !manifestBlob) return null;

    const manifest = JSON.parse(await manifestBlob.text());
    const preferredLanguage = language === "en" ? "en" : "es";
    const resources =
      manifest.resources?.[preferredLanguage] || manifest.resources?.en;
    const reportPath = resources?.report;
    if (!reportPath) return null;

    const { data: reportBlob, error: reportError } = await storage.download(
      `${item.storage_path}/${reportPath}`
    );
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

function toGuideArticle(item, match, excerpt) {
  const direct = match.matchedConditions.length > 0;
  const applicability = direct ? "direct" : "regional_framework";
  const links = buildResourceLinks(item);

  return {
    id: `library:${item.id}`,
    title: item.title,
    abstract:
      excerpt ||
      `Guía clínica disponible en la Biblioteca OpenPhysioAI para orientar la evaluación y el manejo de la región ${
        match.matchedRegions.join(", ") || "consultada"
      }.` ,
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
    query_relevance_score: direct ? 94 : 68,
    reading_priority_score: direct ? 96 : 86,
    preferred_source_tier: 120,
    preferred_source_key: "library_jospt_guideline",
    preferred_source_label_es: "Guía JOSPT de la Biblioteca",
    preferred_source_label_en: "JOSPT guide from the Library",
    guideline_applicability: applicability,
    guideline_scope_label_es: direct
      ? "Aplicación directa a la consulta"
      : "Marco clínico relacionado por región",
    guideline_scope_note_es: direct
      ? "La guía coincide con la condición y la región consultadas."
      : "La guía se recomienda como marco inicial para esta región; la decisión clínica específica debe complementarse con los artículos que responden directamente la pregunta.",
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
} = {}) {
  const regions = detectRegions(query, intent);
  if (!regions.length) return { guides: [], diagnostics: { regions: [] } };

  const specificConditions = detectSpecificConditions(query, intent);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
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
    .eq("is_published", true)
    .not("slug", "is", null);

  if (error) {
    console.warn("Library guide catalog error:", error.message);
    return {
      guides: [],
      diagnostics: { regions: regions.map((region) => region.id), error: true },
    };
  }

  const ranked = (data || [])
    .filter(isGuidelineCatalogItem)
    .map((item) => ({
      item,
      match: scoreCatalogItem(item, regions, specificConditions),
    }))
    .filter(({ match }) => match.matchedRegions.length > 0)
    .sort((left, right) => right.match.score - left.match.score)
    .slice(0, Math.max(1, Math.min(Number(limit) || 2, 3)));

  const guides = await Promise.all(
    ranked.map(async ({ item, match }) => {
      const excerpt = await loadGuideExcerpt(item, language);
      return toGuideArticle(item, match, excerpt);
    })
  );

  return {
    guides,
    diagnostics: {
      version: "1.0.0",
      regions: regions.map((region) => region.id),
      specific_conditions: specificConditions.map((condition) => condition.id),
      catalog_candidates: (data || []).length,
      matched_guides: guides.length,
    },
  };
}

module.exports = {
  BODY_REGIONS,
  SPECIFIC_CONDITIONS,
  detectRegions,
  detectSpecificConditions,
  isGuidelineCatalogItem,
  scoreCatalogItem,
  stripHtml,
  getLibraryGuideRecommendations,
};
