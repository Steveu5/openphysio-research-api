const test = require("node:test");
const assert = require("node:assert/strict");

const {
  finalizeCervicogenicHeadacheArticles,
  finalizeCervicogenicHeadacheAnswer,
} = require("../src/services/cervicogenicHeadacheFinalPass");

const query = "Dolor cervical asociado a cefalea cervicogénica";
const intent = {
  condition: "cervicogenic headache",
  normalized_query: "cervicogenic headache physiotherapy",
};

test("cervical Library guide remains a related framework", () => {
  const guide = {
    title: "Neck Pain: Revision 2017",
    library_resource: { slug: "neck-pain-2017", applicability: "direct" },
    guideline_applicability: "direct",
    evidence_role: "primary",
  };

  const result = finalizeCervicogenicHeadacheArticles([guide], query, intent);
  const refined = result.articles[0];

  assert.equal(refined.guideline_applicability, "component_framework");
  assert.equal(refined.library_resource.applicability, "component_framework");
  assert.equal(refined.evidence_role, "complementary");
  assert.match(refined.guideline_scope_note_es, /no sustituye la evidencia específica/i);
});

test("condition-specific randomized trials are direct evidence", () => {
  const trial = {
    title:
      "Proprioceptive training reduces headache burden in patients with cervicogenic headache: A randomized controlled trial",
    study_type: "Randomized Controlled Trial",
    evidence_level_rank: 6,
    query_relevance_score: 70,
    reading_priority_score: 60,
  };

  const result = finalizeCervicogenicHeadacheArticles([trial], query, intent);
  const refined = result.articles[0];

  assert.equal(refined.evidence_role, "primary");
  assert.equal(refined.clinical_directness, "direct");
  assert.equal(refined.scope_match, "condition_specific_trial");
  assert.ok(refined.query_relevance_score >= 86);
});

test("condition-specific narrative reviews are not labelled as preprints", () => {
  const review = {
    title: "Cervicogenic Headache: Current Perspectives",
    study_type: null,
    evidence_level: "preprint_or_unclear",
    evidence_level_label_es: "Preprint o no claro",
    evidence_level_rank: 1,
  };

  const result = finalizeCervicogenicHeadacheArticles([review], query, intent);
  const refined = result.articles[0];

  assert.equal(refined.study_type, "narrative review");
  assert.equal(refined.evidence_level, "narrative_review");
  assert.equal(refined.evidence_level_label_es, "Revisión narrativa");
});

test("answer keeps specific citations, sorts them, and hedges treatment claims", () => {
  const articles = [
    {
      title: "Neck Pain: Revision 2017",
      library_resource: { slug: "neck" },
      guideline_applicability: "component_framework",
    },
    {
      title:
        "The effectiveness of manual and exercise therapy among patients with cervicogenic headache: a systematic review",
      study_type: "systematic review",
    },
    {
      title: "Manual therapy with exercise for neck pain",
      study_type: "systematic review",
    },
  ];
  const safeAnswer = {
    structured: {
      clinical_answer: [
        {
          text:
            "La terapia manual y el ejercicio terapéutico reducen la frecuencia de la cefalea.",
          source_indices: [3, 2],
        },
      ],
    },
    confidence: { score: 84 },
  };

  const result = finalizeCervicogenicHeadacheAnswer(
    safeAnswer,
    articles,
    query,
    intent,
    "es"
  );
  const item = result.structured.clinical_answer[0];

  assert.deepEqual(item.source_indices, [2]);
  assert.match(item.text, /pueden reducir/i);
});
