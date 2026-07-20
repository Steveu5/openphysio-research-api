const assert = require("node:assert/strict");

const {
  attachLibraryResourcesToCitations,
} = require("../src/services/libraryEvidenceIntegration");

function libraryGuide(overrides = {}) {
  return {
    title: "Knee Pain and Mobility Impairments: Meniscal and Articular Cartilage Lesions Revision 2018",
    doi: "10.2519/jospt.2018.0301",
    library_resource: {
      id: "guide-1",
      slug: "knee-meniscal-articular-cartilage-lesions-2018",
      title: "Knee Pain and Mobility Impairments: Meniscal and Articular Cartilage Lesions Revision 2018",
      links: {
        library:
          "/library?guide=knee-meniscal-articular-cartilage-lesions-2018",
      },
    },
    ...overrides,
  };
}

{
  const citation = {
    title:
      "Knee Pain and Mobility Impairments: Meniscal and Articular Cartilage Lesions Revision 2018.",
    year: 2018,
    reading_priority_score: 91,
  };
  const [linked] = attachLibraryResourcesToCitations(
    [citation],
    [libraryGuide()]
  );

  assert.equal(
    linked.library_resource.slug,
    "knee-meniscal-articular-cartilage-lesions-2018"
  );
  assert.equal(linked.library_link_match.matched_by, "title");
  assert.equal(linked.title, citation.title);
  assert.equal(linked.reading_priority_score, 91);
}

{
  const [linked] = attachLibraryResourcesToCitations(
    [{ title: "Alternate indexed title", doi: "https://doi.org/10.2519/JOSPT.2018.0301" }],
    [libraryGuide()]
  );

  assert.equal(linked.library_link_match.matched_by, "doi");
}

{
  const unrelated = {
    title: "Dutch multidisciplinary guideline on anterior knee pain",
  };
  const [result] = attachLibraryResourcesToCitations(
    [unrelated],
    [libraryGuide()]
  );

  assert.equal(result, unrelated);
  assert.equal(result.library_resource, undefined);
}

{
  const existing = {
    title: "Existing library citation",
    library_resource: { slug: "already-linked" },
  };
  const [result] = attachLibraryResourcesToCitations(
    [existing],
    [libraryGuide()]
  );

  assert.equal(result, existing);
  assert.equal(result.library_resource.slug, "already-linked");
}

console.log("library citation linking checks passed");
