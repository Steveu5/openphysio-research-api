const test = require("node:test");
const assert = require("node:assert/strict");

const {
  identifyProfessionalSource,
  filterProfessionalArticles,
  buildProfessionalPubMedQuery,
} = require("../src/services/trustedSources");

const {
  searchOpenAlex,
} = require("../src/services/openAlex");

test("identifica las principales fuentes profesionales", () => {
  const cases = [
    ["J Orthop Sports Phys Ther", "JOSPT"],
    ["Physical Therapy", "PTJ / APTA"],
    ["J Physiother", "Journal of Physiotherapy"],
    ["Physiotherapy", "Physiotherapy"],
    ["Int J Sports Phys Ther", "IJSPT"],
    [
      "Musculoskelet Sci Pract",
      "Musculoskeletal Science and Practice",
    ],
    ["J Am Acad Orthop Surg", "AAOS / JAAOS"],
    ["Br J Sports Med", "BJSM"],
    [
      "Cochrane Database Syst Rev",
      "Cochrane",
    ],
  ];

  for (const [journal, expected] of cases) {
    assert.equal(
      identifyProfessionalSource({
        journal,
        source_name: "PubMed",
      })?.label,
      expected
    );
  }
});

test("identifica guías APTA y AAOS", () => {
  assert.equal(
    identifyProfessionalSource({
      title:
        "Clinical Practice Guideline from the Academy of Orthopaedic Physical Therapy",
      journal: "J Orthop Sports Phys Ther",
      source_name: "PubMed",
    })?.label,
    "JOSPT"
  );

  assert.equal(
    identifyProfessionalSource({
      title:
        "American Academy of Orthopaedic Surgeons Clinical Practice Guideline",
      source_name: "PubMed",
    })?.label,
    "AAOS / OrthoGuidelines"
  );
});

test("descarta fuentes académicas generales", () => {
  const filtered = filterProfessionalArticles([
    {
      title: "Generic research article",
      journal: "Generic Multidisciplinary Journal",
      source_name: "Semantic Scholar",
    },
    {
      title: "Professional article",
      journal:
        "Journal of Orthopaedic and Sports Physical Therapy",
      source_name: "PubMed",
    },
  ]);

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].source_name, "JOSPT");
  assert.equal(
    filtered[0].retrieval_source_name,
    "PubMed"
  );
});

test("construye una búsqueda PubMed profesional", () => {
  const query = buildProfessionalPubMedQuery(
    "chronic low back pain exercise"
  );

  assert.match(
    query,
    /J Orthop Sports Phys Ther/
  );
  assert.match(query, /Phys Ther/);
  assert.match(query, /J Physiother/);
  assert.match(query, /J Am Acad Orthop Surg/);
  assert.match(
    query,
    /Cochrane Database Syst Rev/
  );
});

test("OpenAlex no participa en resultados clínicos", async () => {
  assert.deepEqual(
    await searchOpenAlex("low back pain"),
    []
  );
});
