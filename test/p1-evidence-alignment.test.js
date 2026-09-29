const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { assessChatEvidence, CONFIDENCE_WINDOW } = require("../src/services/chatEvidenceAssessment");

// Sources as the P0 ranking delivers them (clinical_match already set).
let n = 0;
const src = (tier, extra = {}) => ({
  id: `a${(n += 1)}`,
  title: extra.title || `${tier} source ${n}`,
  abstract: "text",
  study_type: extra.study_type || "randomized controlled trial",
  evidence_level_rank: extra.rank || 7,
  appraisal_flags: extra.appraised ? ["reporta evaluación de riesgo de sesgo/calidad"] : [],
  clinical_match: { tier, direct_comparison: Boolean(extra.h2h), components: { design: (extra.rank || 7) / 10 } },
});
const review = (tier = "direct", extra = {}) => src(tier, { study_type: "systematic review", rank: 9, appraised: true, ...extra });
const guide = (tier = "direct") => src(tier, { study_type: "clinical practice guideline", rank: 10, appraised: true });
const intent = { condition: "x", question_type: "treatment" };
const cmpIntent = { condition: "x", question_type: "comparison", intervention: "A", comparator: "B" };

// Every claim must be traceable to cited sources only.
function assertTraceable(result) {
  const cited = new Set(result.citedArticles.map((a) => a.id));
  const count = result.citedArticles.length;
  const inRange = (indices) => indices.every((i) => i >= 1 && i <= count);
  for (const key of ["cited_source_indices", "sufficiency_basis", "direct_source_indices", "comparison_basis", "confidence_basis"]) {
    assert.ok(inRange(result.audit[key]), key);
  }
  assert.equal(result.sufficiency.article_count, count);
  const confidence = result.confidence({ consistency: "consistent" });
  assert.equal(confidence.metrics.article_count, Math.min(count, CONFIDENCE_WINDOW));
  assert.ok(confidence.metrics.direct_articles <= result.audit.direct_source_indices.length);
  if (result.comparison.requested) {
    for (const title of result.comparison.direct_titles) {
      assert.ok(result.citedArticles.some((a) => a.title === title), `comparison cites ${title}`);
    }
    assert.equal(result.comparison.direct_count, result.audit.comparison_basis.length);
  }
  return { cited, confidence };
}

test("A. two final sources: every assessment rests on those two", () => {
  const ranked = [guide(), review(), src("tangential"), src("direct", { rank: 7 })];
  const result = assessChatEvidence(ranked, intent);
  assert.equal(result.citedArticles.length, 2);
  const { confidence } = assertTraceable(result);
  assert.equal(result.sufficiency.status, "sufficient");
  assert.deepEqual(result.audit.confidence_basis, [1, 2]);
  assert.equal(confidence.metrics.tangential_articles, 0);
});

test("B. five final sources: sufficiency and directness cover all five", () => {
  const ranked = [src("direct"), src("partial"), src("partial"), src("direct"), src("partial"), src("direct"), src("direct")];
  const result = assessChatEvidence(ranked, intent);
  assert.equal(result.citedArticles.length, 5);
  assertTraceable(result);
  assert.equal(result.sufficiency.usable_count, 5);
  assert.deepEqual(result.audit.sufficiency_basis, [1, 2, 3, 4, 5]);
});

test("C. comparison with six sources: comparison support is only cited head-to-head studies", () => {
  const ranked = [
    review("direct"), src("direct"), src("direct", { h2h: true, title: "A vs B trial" }),
    src("partial"), src("partial"), src("direct", { h2h: true, title: "A vs B second trial" }), src("direct", { h2h: true, title: "not selected" }),
  ];
  const result = assessChatEvidence(ranked, cmpIntent);
  assert.equal(result.citedArticles.length, 6);
  assertTraceable(result);
  assert.equal(result.comparison.direct, true);
  assert.deepEqual(result.comparison.direct_titles.sort(), ["A vs B second trial", "A vs B trial"]);
  assert.ok(!result.comparison.direct_titles.includes("not selected"));
});

test("D. an important top-4 source that is not selected cannot affect any claim", () => {
  // Top 4: guideline + review (core covered at 2), then a tangential source
  // and a head-to-head trial at rank 4 that is NOT selected.
  const hidden = src("direct", { h2h: true, title: "Hidden head-to-head trial" });
  const ranked = [review("direct"), review("direct"), src("tangential"), hidden];
  const result = assessChatEvidence(ranked, intent);
  assert.ok(!result.citedArticles.includes(hidden));
  const { confidence } = assertTraceable(result);
  assert.equal(confidence.metrics.article_count, 2);

  // As a comparison, the hidden trial may not be claimed as head-to-head
  // support: either it is cited, or the answer states there is none.
  const cmpRanked = [review("direct"), review("direct"), src("direct"), src("direct"), src("direct", { h2h: true, title: "Rank 5 h2h" })];
  const cmp = assessChatEvidence(cmpRanked, cmpIntent);
  assertTraceable(cmp);
  if (!cmp.citedArticles.some((a) => a.title === "Rank 5 h2h")) {
    assert.equal(cmp.comparison.direct, false);
    assert.ok(cmp.comparison.statement);
  }
});

test("the Chat route uses the cited-source assessment for every final claim", () => {
  const chat = fs.readFileSync(path.join(__dirname, "../src/routes/chat.js"), "utf8");
  assert.doesNotMatch(chat, /assessmentArticles/);
  assert.match(chat, /const evidenceSufficiency = chatEvidence\.sufficiency/);
  assert.match(chat, /const comparison = chatEvidence\.comparison/);
  assert.equal((chat.match(/chatEvidence\.confidence\(/g) || []).length, 3);
  assert.match(chat, /evidenceAudit: chatEvidence\.audit/);
  assert.doesNotMatch(chat, /assessEvidenceConfidence\(/);
});
