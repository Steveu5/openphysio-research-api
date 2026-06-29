const {
  searchCochraneCrossref,
} = require("./cochraneCrossref");

const {
  enrichArticlesWithEuropePmcMetadata,
} = require("./europePmc");

const {
  filterProfessionalArticles,
} = require("./trustedSources");

function buildCrossrefFilter(filters = {}) {
  const clauses = [];

  if (filters.year_from != null) {
    clauses.push(
      `from-pub-date:${filters.year_from}-01-01`
    );
  }

  if (filters.year_to != null) {
    clauses.push(
      `until-pub-date:${filters.year_to}-12-31`
    );
  }

  return clauses.join(",");
}

async function searchCrossref(
  query,
  limit = 10,
  filters = {}
) {
  const results = await searchCochraneCrossref(
    query,
    Math.min(Number(limit) || 10, 20),
    filters
  );

  const professionalResults = filterProfessionalArticles(results);

  return enrichArticlesWithEuropePmcMetadata(
    professionalResults,
    {
      maxArticles: Math.min(Number(limit) || 10, 20),
      minAbstractLength: 500,
    }
  );
}

module.exports = {
  searchCrossref,
  buildCrossrefFilter,
};
