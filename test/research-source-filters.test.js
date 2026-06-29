const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeResearchFilters,
  articleMatchesResearchFilters,
} = require("../src/utils/researchFilters");
const { buildPubMedQuery } = require("../src/services/pubmed");
const { buildEuropePmcQuery } = require("../src/services/europePmc");
const { buildOpenAlexFilter } = require("../src/services/openAlex");
const { buildCrossrefFilter } = require("../src/services/crossref");

test("normalizeResearchFilters prioriza filtros explícitos", () => {
  const result = normalizeResearchFilters(
    {
      year_from: 2020,
      open_access: true,
      study_types: [
        "Systematic Review",
        "Randomized Controlled Trial",
      ],
    },
    {
      year_from: 2015,
      year_to: 2024,
      open_access: false,
    },
    2026
  );

  assert.deepEqual(result, {
    year_from: 2020,
    year_to: 2024,
    open_access: true,
    study_types: [
      "systematic review",
      "randomized controlled trial",
    ],
  });
});

test("normalizeResearchFilters resuelve presets de año", () => {
  assert.deepEqual(
    normalizeResearchFilters({ year_preset: "last_5" }, {}, 2026),
    {
      year_from: 2021,
      year_to: null,
      open_access: null,
      study_types: [],
    }
  );

  assert.deepEqual(
    normalizeResearchFilters({ year_preset: "before_2020" }, {}, 2026),
    {
      year_from: null,
      year_to: 2019,
      open_access: null,
      study_types: [],
    }
  );
});

test("articleMatchesResearchFilters aplica año y acceso abierto", () => {
  assert.equal(
    articleMatchesResearchFilters(
      { year: 2023, open_access: true },
      { year_from: 2020, year_to: 2025, open_access: true }
    ),
    true
  );

  assert.equal(
    articleMatchesResearchFilters(
      { year: 2019, open_access: true },
      { year_from: 2020 }
    ),
    false
  );

  assert.equal(
    articleMatchesResearchFilters(
      { year: null, open_access: true },
      { year_to: 2025 }
    ),
    false
  );

  assert.equal(
    articleMatchesResearchFilters(
      { year: 2023, open_access: false },
      { open_access: true }
    ),
    false
  );
});

test("articleMatchesResearchFilters aplica revisiones y metaanálisis", () => {
  const filters = {
    study_types: ["systematic review", "meta-analysis"],
  };

  assert.equal(
    articleMatchesResearchFilters(
      { study_type: "systematic review and meta-analysis" },
      filters
    ),
    true
  );

  assert.equal(
    articleMatchesResearchFilters(
      { study_type: "systematic review" },
      filters
    ),
    true
  );

  assert.equal(
    articleMatchesResearchFilters(
      { study_type: "randomized controlled trial" },
      filters
    ),
    false
  );
});

test("articleMatchesResearchFilters aplica guías y ECA", () => {
  assert.equal(
    articleMatchesResearchFilters(
      { study_type: "clinical practice guideline" },
      { study_types: ["clinical practice guideline"] }
    ),
    true
  );

  assert.equal(
    articleMatchesResearchFilters(
      { study_type: "randomised controlled trial" },
      { study_types: ["randomized controlled trial"] }
    ),
    true
  );

  assert.equal(
    articleMatchesResearchFilters(
      { study_type: "review" },
      { study_types: ["systematic review"] }
    ),
    false
  );
});

test("articleMatchesResearchFilters rechaza artículos sin tipo cuando se solicita uno", () => {
  assert.equal(
    articleMatchesResearchFilters(
      { study_type: null },
      { study_types: ["systematic review"] }
    ),
    false
  );
});

test("buildPubMedQuery aplica fechas y acceso gratuito", () => {
  assert.equal(
    buildPubMedQuery("low back pain exercise", {
      year_from: 2020,
      year_to: 2025,
      open_access: true,
    }),
    '(low back pain exercise) AND ("2020/01/01"[Date - Publication] : "2025/12/31"[Date - Publication]) AND free full text[sb]'
  );
});

test("buildPubMedQuery traduce tipos de estudio compatibles", () => {
  assert.equal(
    buildPubMedQuery("rotator cuff rehabilitation", {
      study_types: [
        "systematic review",
        "meta-analysis",
      ],
    }),
    '(rotator cuff rehabilitation) AND ("Systematic Review"[Publication Type] OR "Meta-Analysis"[Publication Type])'
  );
});

test("buildEuropePmcQuery aplica fechas y acceso abierto", () => {
  assert.equal(
    buildEuropePmcQuery("low back pain exercise", {
      year_from: 2020,
      year_to: 2025,
      open_access: true,
    }),
    "(low back pain exercise) AND FIRST_PDATE:[2020-01-01 TO 2025-12-31] AND OPEN_ACCESS:Y"
  );
});

test("buildOpenAlexFilter construye filtros compatibles", () => {
  assert.equal(
    buildOpenAlexFilter({
      year_from: 2020,
      year_to: 2025,
      open_access: true,
    }),
    "from_publication_date:2020-01-01,to_publication_date:2025-12-31,is_oa:true"
  );

  assert.equal(buildOpenAlexFilter({}), "");
});

test("buildCrossrefFilter aplica únicamente filtros de fecha", () => {
  assert.equal(
    buildCrossrefFilter({
      year_from: 2020,
      year_to: 2025,
      open_access: true,
      study_types: ["randomized controlled trial"],
    }),
    "from-pub-date:2020-01-01,until-pub-date:2025-12-31"
  );

  assert.equal(
    buildCrossrefFilter({ year_from: 2021 }),
    "from-pub-date:2021-01-01"
  );

  assert.equal(
    buildCrossrefFilter({ year_to: 2019 }),
    "until-pub-date:2019-12-31"
  );

  assert.equal(buildCrossrefFilter({}), "");
});
