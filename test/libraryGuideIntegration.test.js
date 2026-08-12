const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  canUsePreviewCatalog,
  detectRegions,
  detectSpecificConditions,
  isGuidelineCatalogItem,
  scoreCatalogItem,
  BODY_REGIONS,
} = require("../src/services/libraryGuideRecommendations");
const {
  combineEvidenceWithLibrary,
  restoreLibraryGuideScope,
  prioritizeLibraryGuides,
  getEvidenceBasisIncludingLibrary,
  appendLibraryStudyLinks,
} = require("../src/services/libraryEvidenceIntegration");

function libraryGuide(applicability = "regional_framework", overrides = {}) {
  return {
    id: "library:11111111-1111-4111-8111-111111111111",
    title: "Knee Stability and Movement Coordination Impairments: Clinical Practice Guideline",
    abstract: "Recommendations for rehabilitation after anterior cruciate ligament injury.",
    journal: "J Orthop Sports Phys Ther",
    year: 2023,
    evidence_level: "clinical_practice_guideline",
    evidence_level_rank: 10,
    query_relevance_score: 95,
    reading_priority_score: 95,
    library_resource: {
      id: "11111111-1111-4111-8111-111111111111",
      slug: "knee-stability-clinical-practice-guideline",
      title: "Knee Stability and Movement Coordination Impairments: Clinical Practice Guideline",
      journal_name: "J Orthop Sports Phys Ther",
      publication_year: 2023,
      applicability,
      links: {
        report: "/library?guide=knee-stability-clinical-practice-guideline&resource=report",
        audio: "/library?guide=knee-stability-clinical-practice-guideline&resource=audio",
        infographics: "/library?guide=knee-stability-clinical-practice-guideline&resource=infographics",
      },
    },
    ...overrides,
  };
}

test("body-region matching recognizes cervical, lumbar, knee, and ankle queries", () => {
  assert.deepEqual(
    detectRegions("dolor cervical y cefalea", {}).map((item) => item.id),
    ["cervical"]
  );
  assert.deepEqual(
    detectRegions("qué hago para dolor lumbar", {}).map((item) => item.id),
    ["lumbar"]
  );
  assert.deepEqual(
    detectRegions("ejercicios para dolor de rodilla", {}).map((item) => item.id),
    ["knee"]
  );
  assert.deepEqual(
    detectRegions("esguince de tobillo", {}).map((item) => item.id),
    ["ankle_foot"]
  );
});

test("specific-condition matching distinguishes ACL from generic knee pain", () => {
  assert.deepEqual(
    detectSpecificConditions("dolor de rodilla", {}).map((item) => item.id),
    []
  );
  assert.ok(
    detectSpecificConditions("rehabilitación después de lesión de LCA", {})
      .map((item) => item.id)
      .includes("acl")
  );
});

test("only actual guideline records are eligible, not every JOSPT article", () => {
  assert.equal(
    isGuidelineCatalogItem({
      title: "Exercise dosage after ACL reconstruction: a cohort study",
      category: "Research article",
      journal_name: "J Orthop Sports Phys Ther",
    }),
    false
  );

  assert.equal(
    isGuidelineCatalogItem({
      title: "Neck Pain: Revision 2017 Clinical Practice Guidelines",
      category: "Clinical Practice Guideline",
      journal_name: "J Orthop Sports Phys Ther",
    }),
    true
  );
});

test("catalog ranking recognizes real ACL guideline title patterns", () => {
  const kneeRegion = BODY_REGIONS.filter((item) => item.id === "knee");
  const aclCondition = detectSpecificConditions("rehabilitación de ACL", {});
  const match = scoreCatalogItem(
    {
      title: "Knee Stability and Movement Coordination Impairments: Clinical Practice Guideline",
      category: "Clinical Practice Guideline",
      journal_name: "J Orthop Sports Phys Ther",
      is_complete: true,
    },
    kneeRegion,
    aclCondition
  );

  assert.ok(match.matchedRegions.includes("knee"));
  assert.ok(match.matchedConditions.includes("acl"));
  assert.ok(match.score > 200);
});

test("Library preview access is restricted to configured emails", () => {
  const previous = process.env.LIBRARY_PREVIEW_EMAILS;
  process.env.LIBRARY_PREVIEW_EMAILS = "owner@example.com, second@example.com";

  try {
    assert.equal(canUsePreviewCatalog("OWNER@example.com"), true);
    assert.equal(canUsePreviewCatalog("other@example.com"), false);
  } finally {
    if (previous === undefined) delete process.env.LIBRARY_PREVIEW_EMAILS;
    else process.env.LIBRARY_PREVIEW_EMAILS = previous;
  }
});

test("fresh Library catalog replaces stale cached Library pseudo-articles", () => {
  const stale = libraryGuide("regional_framework", {
    title: "Old unpublished guide",
    library_resource: {
      ...libraryGuide().library_resource,
      slug: "old-unpublished-guide",
      title: "Old unpublished guide",
    },
  });
  const fresh = libraryGuide("regional_framework");
  const external = {
    id: "22222222-2222-4222-8222-222222222222",
    title: "Exercise therapy for nonspecific knee pain",
  };

  const combined = combineEvidenceWithLibrary([stale, external], [fresh]);

  assert.equal(combined.some((item) => item.title === "Old unpublished guide"), false);
  assert.equal(combined[0].library_resource.slug, fresh.library_resource.slug);
  assert.equal(combined.some((item) => item.title === external.title), true);
});

test("regional guides stay regional, rank first, and cannot inflate direct relevance", () => {
  const guide = libraryGuide("regional_framework");
  const external = {
    id: "22222222-2222-4222-8222-222222222222",
    title: "Exercise therapy for nonspecific knee pain",
    query_relevance_score: 92,
    reading_priority_score: 90,
  };

  const prioritized = prioritizeLibraryGuides([external, guide]);
  const restored = prioritized[0];

  assert.equal(restored.library_resource.slug, guide.library_resource.slug);
  assert.equal(restored.guideline_applicability, "regional_framework");
  assert.ok(restored.query_relevance_score <= 62);
  assert.ok(restored.reading_priority_score >= 86);
  assert.match(restored.abstract, /únicamente como marco clínico/i);
  assert.match(restored.abstract, /No generalices recomendaciones específicas/i);
});

test("condition-specific Library guides receive direct applicability", () => {
  const restored = restoreLibraryGuideScope(libraryGuide("direct"));

  assert.equal(restored.guideline_applicability, "direct");
  assert.ok(restored.query_relevance_score >= 90);
  assert.ok(restored.reading_priority_score >= 96);
  assert.match(restored.abstract, /coincide directamente/i);
});

test("Library guide becomes the declared basis and exposes learning resources", () => {
  const guide = restoreLibraryGuideScope(libraryGuide("regional_framework"));
  const basis = getEvidenceBasisIncludingLibrary([guide], "es");
  const reply = appendLibraryStudyLinks(
    "Respuesta clínica\nLa guía orienta el marco regional.",
    [
      {
        title: guide.title,
        links: guide.library_resource.links,
      },
    ],
    "es"
  );

  assert.equal(basis.key, "library_jospt_guideline");
  assert.equal(basis.applicability, "regional_framework");
  assert.match(basis.label, /Biblioteca OpenPhysioAI/);
  assert.match(reply, /Leer resumen/);
  assert.match(reply, /Escuchar audio/);
  assert.match(reply, /Ver infografías/);
});

test("Research and Chat both integrate Library guides before synthesis", () => {
  const root = path.join(__dirname, "..");
  const research = fs.readFileSync(
    path.join(root, "src/routes/research.js"),
    "utf8"
  );
  const chat = fs.readFileSync(path.join(root, "src/routes/chat.js"), "utf8");
  const supabase = fs.readFileSync(
    path.join(root, "src/services/supabase.js"),
    "utf8"
  );

  for (const source of [research, chat]) {
    assert.match(source, /getLibraryGuideRecommendations/);
    assert.match(source, /combineEvidenceWithLibrary/);
    assert.match(source, /userEmail: req\.user\.email/);
    assert.match(source, /libraryGuideIntegrationVersion: "2\.0\.0"/);
  }

  assert.match(chat, /prioritizeLibraryGuides/);
  assert.match(chat, /libraryRecommendations/);
  assert.match(research, /libraryRecommendations/);
  assert.match(supabase, /filter\(\(article\) => isUuid\(article\.id\)\)/);
});
