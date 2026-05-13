const { enrichEvidenceMetadata } = require("./evidenceLevel");

function studyTypeScore(article = {}) {
  const evidenceRank = Number(article.evidence_level_rank || 1);
  return evidenceRank * 12;
}

function textIncludes(value, term) {
  if (!value || !term) return false;
  return value.toLowerCase().includes(String(term).toLowerCase());
}

function rankArticles(articles, intent = {}) {
  const nowYear = new Date().getFullYear();

  return articles
    .map((rawArticle) => {
      const article = enrichEvidenceMetadata(rawArticle, intent);
      let score = 0;
      const reasons = [];

      const typeScore = studyTypeScore(article);
      score += typeScore;
      if (article.evidence_level_rank >= 7) {
        reasons.push(`Nivel de evidencia: ${article.evidence_level_label_es}`);
      }

      if (article.physiotherapy_relevance_score) {
        score += article.physiotherapy_relevance_score;
        if (article.physiotherapy_relevance_score >= 8) {
          reasons.push("Relevante para fisioterapia/rehabilitación");
        }
      }

      if (article.year) {
        const age = Math.max(0, nowYear - article.year);
        const recencyScore = Math.max(0, 20 - age * 1.5);
        score += recencyScore;
        if (recencyScore >= 12) reasons.push("Publicación reciente");
      }

      if (article.abstract) {
        score += 10;
        reasons.push("Tiene resumen disponible");
      }

      if (article.open_access) {
        score += 5;
        reasons.push("Acceso abierto");
      }

      const combined = `${article.title || ""} ${article.abstract || ""}`;

      for (const term of intent.search_terms || []) {
        if (textIncludes(combined, term)) score += 3;
      }

      if (intent.condition && textIncludes(combined, intent.condition)) {
        score += 14;
        reasons.push("Coincide con la condición");
      }

      if (intent.intervention && textIncludes(combined, intent.intervention)) {
        score += 14;
        reasons.push("Coincide con la intervención");
      }

      if (intent.population && textIncludes(combined, intent.population)) {
        score += 6;
        reasons.push("Coincide con la población");
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
