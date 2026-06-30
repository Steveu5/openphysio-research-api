const BENCHMARK_VERSION = "1.0.0";

const CASE_DEFINITIONS = [
  {
    id: "low_back_pain",
    condition: "chronic low back pain",
    body_region: "lumbar spine",
    intervention: "exercise therapy",
    competing_condition: "knee osteoarthritis",
  },
  {
    id: "neck_pain",
    condition: "mechanical neck pain",
    body_region: "cervical spine",
    intervention: "exercise therapy",
    competing_condition: "hip osteoarthritis",
  },
  {
    id: "cervical_radiculopathy",
    condition: "cervical radiculopathy",
    body_region: "cervical spine",
    intervention: "exercise therapy",
    competing_condition: "rotator cuff related shoulder pain",
  },
  {
    id: "shoulder_rotator_cuff",
    condition: "rotator cuff related shoulder pain",
    body_region: "shoulder",
    intervention: "therapeutic exercise",
    competing_condition: "chronic low back pain",
  },
  {
    id: "knee_osteoarthritis",
    condition: "knee osteoarthritis",
    body_region: "knee",
    intervention: "strengthening exercise",
    competing_condition: "neck pain",
  },
  {
    id: "hip_osteoarthritis",
    condition: "hip osteoarthritis",
    body_region: "hip",
    intervention: "strengthening exercise",
    competing_condition: "plantar heel pain",
  },
  {
    id: "patellofemoral_pain",
    condition: "patellofemoral pain",
    body_region: "knee",
    intervention: "exercise therapy",
    competing_condition: "lateral ankle sprain",
  },
  {
    id: "achilles_tendinopathy",
    condition: "achilles tendinopathy",
    body_region: "ankle",
    intervention: "progressive loading exercise",
    competing_condition: "patellar tendinopathy",
  },
  {
    id: "patellar_tendinopathy",
    condition: "patellar tendinopathy",
    body_region: "knee",
    intervention: "progressive loading exercise",
    competing_condition: "achilles tendinopathy",
  },
  {
    id: "lateral_elbow_tendinopathy",
    condition: "lateral elbow tendinopathy",
    body_region: "elbow",
    intervention: "exercise therapy",
    competing_condition: "rotator cuff related shoulder pain",
  },
  {
    id: "plantar_heel_pain",
    condition: "plantar heel pain",
    body_region: "foot",
    intervention: "exercise therapy",
    competing_condition: "hip osteoarthritis",
  },
  {
    id: "lateral_ankle_sprain",
    condition: "lateral ankle sprain",
    body_region: "ankle",
    intervention: "neuromuscular exercise",
    competing_condition: "patellofemoral pain",
  },
];

function makeArticle({
  id,
  title,
  abstract,
  studyType,
  journal,
  year = 2025,
  tags = [],
}) {
  return {
    id,
    source_name: "Benchmark fixture",
    source_id: id,
    title,
    abstract,
    study_type: studyType,
    journal,
    year,
    publication_date: `${year}-01-01`,
    authors_text: "OpenPhysio Benchmark Group",
    open_access: true,
    benchmark_tags: tags,
  };
}

function buildCase(definition) {
  const {
    id,
    condition,
    body_region: bodyRegion,
    intervention,
    competing_condition: competingCondition,
  } = definition;

  const directAbstract = [
    `Adults with ${condition} received ${intervention} delivered by physical therapists.`,
    "The intervention targeted pain, disability, physical function, and quality of life.",
    "The report includes treatment frequency, duration, progression, effect estimates, and clinical recommendations.",
  ].join(" ");

  const articles = [
    makeArticle({
      id: `${id}:guideline`,
      title: `${condition}: clinical practice guideline for physical therapy rehabilitation`,
      abstract: `${directAbstract} Recommendations were developed using GRADE and a formal evidence appraisal process.`,
      studyType: "Clinical Practice Guideline",
      journal: "Journal of Orthopaedic and Sports Physical Therapy",
      tags: ["target", "completed", "guideline"],
    }),
    makeArticle({
      id: `${id}:review`,
      title: `${intervention} for ${condition}: systematic review and meta-analysis`,
      abstract: `${directAbstract} Multiple databases were searched, risk of bias was assessed, and a meta-analysis reported confidence intervals.`,
      studyType: "Systematic Review and Meta-Analysis",
      journal: "Journal of Physiotherapy",
      tags: ["target", "completed", "review"],
    }),
    makeArticle({
      id: `${id}:trial`,
      title: `${intervention} for ${condition}: randomized controlled trial`,
      abstract: `${directAbstract} Participants were randomized to a progressive rehabilitation programme or comparator care.`,
      studyType: "Randomized Controlled Trial",
      journal: "Physical Therapy and Rehabilitation Journal",
      tags: ["target", "completed", "trial"],
    }),
    makeArticle({
      id: `${id}:protocol`,
      title: `${intervention} for ${condition}: study protocol`,
      abstract: `This protocol describes a future randomized trial of ${intervention} for adults with ${condition}. Recruitment has not been completed and no clinical outcomes are available.`,
      studyType: "Study Protocol",
      journal: "Trials",
      tags: ["target", "protocol"],
    }),
    makeArticle({
      id: `${id}:competing`,
      title: `${competingCondition}: clinical practice guideline for exercise therapy`,
      abstract: `This guideline provides physical therapy and exercise recommendations for adults with ${competingCondition}, including pain and function outcomes.`,
      studyType: "Clinical Practice Guideline",
      journal: "Journal of Orthopaedic and Sports Physical Therapy",
      tags: ["competing_condition", "guideline"],
    }),
    makeArticle({
      id: `${id}:secondary`,
      title: `Cost-effectiveness of ${intervention} for ${condition}: prospective cohort study`,
      abstract: `This economic evaluation examined costs and service implementation for ${intervention} in people with ${condition}. Clinical effectiveness was a secondary outcome.`,
      studyType: "Cohort Study",
      journal: "Health Economics Review",
      tags: ["target", "secondary_focus"],
    }),
  ];

  return {
    id,
    label: condition,
    intent: {
      condition,
      body_region: bodyRegion,
      intervention,
      population: "adults",
      outcome: "pain disability and physical function",
      normalized_query: `${condition} ${intervention} adults`,
      search_terms: [condition, intervention, "physical therapy", "pain", "function"],
    },
    articles,
    relevance: {
      [`${id}:guideline`]: 3,
      [`${id}:review`]: 3,
      [`${id}:trial`]: 2,
      [`${id}:secondary`]: 1,
      [`${id}:protocol`]: 0,
      [`${id}:competing`]: 0,
    },
    preferred_pairs: [
      [`${id}:guideline`, `${id}:competing`],
      [`${id}:review`, `${id}:protocol`],
      [`${id}:trial`, `${id}:secondary`],
    ],
  };
}

const RANKING_BENCHMARK_CASES = CASE_DEFINITIONS.map(buildCase);

module.exports = {
  BENCHMARK_VERSION,
  CASE_DEFINITIONS,
  RANKING_BENCHMARK_CASES,
  buildCase,
};
