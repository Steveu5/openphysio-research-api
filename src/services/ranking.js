function studyTypeScore(studyType = "") {
  const s = String(studyType || "").toLowerCase();

  if (s.includes("clinical practice guideline")) return 100;
  if (s.includes("systematic review") && s.includes("meta")) return 95;
  if (s.includes("meta-analysis")) return 90;
  if (s.includes("systematic review")) return 85;
  if (s.includes("randomized") || s.includes("randomised")) return 75;
  if (s.includes("cohort")) return 45;
  if (s.includes("case-control")) return 40;
  if (s.includes("cross-sectional")) return 35;
  return 20;
}

function textIncludes(value, term) {
  if (!value || !term) return false;
  return value.toLowerCase().includes(String(term).toLowerCase());
}

function rankArticles(articles, intent = {}) {
  const nowYear = new Date().getFullYear();

  return articles
    .map((article) => {
      let score = 0;
      const reasons = [];

      const typeScore = studyTypeScore(article.study_type);
      score += typeScore;
      if (typeScore >= 75) reasons.push(`High-level evidence type: ${article.study_type}`);

      if (article.year) {
        const age = Math.max(0, nowYear - article.year);
        const recencyScore = Math.max(0, 25 - age * 2);
        score += recencyScore;
        if (recencyScore >= 15) reasons.push("Recent publication");
      }

      if (article.abstract) {
        score += 10;
        reasons.push("Has abstract");
      }

      if (article.open_access) {
        score += 5;
        reasons.push("Open access");
      }

      const combined = `${article.title || ""} ${article.abstract || ""}`;

      for (const term of intent.search_terms || []) {
        if (textIncludes(combined, term)) score += 4;
      }

      if (intent.condition && textIncludes(combined, intent.condition)) {
        score += 12;
        reasons.push("Matches condition");
      }

      if (intent.intervention && textIncludes(combined, intent.intervention)) {
        score += 12;
        reasons.push("Matches intervention");
      }

      if (intent.population && textIncludes(combined, intent.population)) {
        score += 6;
        reasons.push("Matches population");
      }

      return {
        ...article,
        relevance_score: Number(score.toFixed(2)),
        ranking_reason: reasons.join("; "),
      };
    })
    .sort((a, b) => b.relevance_score - a.relevance_score);
}

module.exports = { rankArticles };
