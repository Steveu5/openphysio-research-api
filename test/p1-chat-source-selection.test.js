const test = require("node:test");
const assert = require("node:assert/strict");
const { selectChatSources, MIN_SOURCES, MAX_SOURCES, MAX_COMPARISON_SOURCES } = require("../src/services/chatSourceSelection");

const src = (title, tier, extra = {}) => ({ title, clinical_match: { tier, ...(extra.match || {}) }, study_type: extra.study_type || "randomized controlled trial", ...extra });
const guide = (tier = "direct") => src("Guideline", tier, { study_type: "clinical practice guideline" });
const review = (tier = "direct") => src("Systematic review", tier, { study_type: "systematic review" });
const titles = (result) => result.articles.map((a) => a.title);

test("a good guideline plus a systematic review can be enough", () => {
  const ranked = [guide(), review(), src("RCT 1", "direct"), src("RCT 2", "direct"), src("RCT 3", "direct")];
  const result = selectChatSources(ranked, { question_type: "treatment" });
  assert.deepEqual(titles(result), ["Guideline", "Systematic review"]);
  assert.equal(result.diagnostics.rule, "core_covered");
});

test("never a single source, even when only one applies", () => {
  const ranked = [src("Only direct RCT", "direct"), src("Tangential A", "tangential"), src("Tangential B", "tangential")];
  const result = selectChatSources(ranked, {});
  assert.equal(result.articles.length, MIN_SOURCES);
  assert.equal(result.articles[0].title, "Only direct RCT");
});

test("never more than the maximum, and tangential sources are not added", () => {
  const ranked = [
    ...Array.from({ length: 8 }, (_, i) => src(`Partial ${i}`, "partial")),
    src("Direct trial", "direct"),
    ...Array.from({ length: 5 }, (_, i) => src(`Tangential ${i}`, "tangential")),
  ];
  const result = selectChatSources(ranked, {});
  assert.ok(result.articles.length <= MAX_SOURCES);
  assert.ok(result.articles.every((a) => a.clinical_match.tier !== "tangential"));
});

test("limited evidence (no direct source) uses few sources", () => {
  const ranked = Array.from({ length: 6 }, (_, i) => src(`Partial ${i}`, "partial"));
  const result = selectChatSources(ranked, {});
  assert.equal(result.articles.length, 3);
});

test("comparisons keep going until head-to-head evidence is covered", () => {
  const intent = { question_type: "comparison", intervention: "A", comparator: "B" };
  const h2h = (t) => src(t, "direct", { match: { direct_comparison: true } });
  const ranked = [review(), src("Direct RCT of A", "direct"), src("Direct RCT of B", "direct"), h2h("A vs B trial 1"), h2h("A vs B trial 2"), src("More", "direct"), src("Even more", "direct")];
  const result = selectChatSources(ranked, intent);
  assert.ok(titles(result).includes("A vs B trial 1"));
  assert.ok(result.articles.length <= MAX_COMPARISON_SOURCES);
  assert.ok(result.articles.length > 2);
});

test("unfinished protocols are not selected as usable sources", () => {
  const ranked = [src("Exercise for X: a randomized controlled trial protocol", "partial"), review(), src("RCT", "direct")];
  const result = selectChatSources(ranked, {});
  assert.ok(!titles(result).some((t) => /protocol/.test(t)));
});

test("when nothing applies, the closest sources are shown for the insufficient-evidence answer", () => {
  const ranked = Array.from({ length: 6 }, (_, i) => src(`Tangential ${i}`, "tangential"));
  const result = selectChatSources(ranked, {});
  assert.equal(result.articles.length, 3);
  assert.equal(result.diagnostics.rule, "none_applicable_closest");
});

test("selection never reorders the P0 ranking", () => {
  const ranked = [src("A", "partial"), guide(), src("C", "partial"), review()];
  const result = selectChatSources(ranked, {});
  const positions = result.articles.map((a) => ranked.indexOf(a));
  assert.deepEqual(positions, [...positions].sort((x, y) => x - y));
});

test("Chat computes sufficiency, comparison and confidence on the unchanged P0 top 4", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const chat = fs.readFileSync(path.join(__dirname, "../src/routes/chat.js"), "utf8");
  assert.match(chat, /const assessmentArticles = rankedForChat\.slice\(0, 4\)/);
  assert.match(chat, /assessEvidenceSufficiency\(assessmentArticles\)/);
  assert.match(chat, /assessComparison\(\s*assessmentArticles/);
  assert.doesNotMatch(chat, /assessEvidenceConfidence\(citedArticles/);
});
