function buildOpenAlexFilter(filters = {}) {
  const clauses = [];

  if (filters.year_from != null) {
    clauses.push(
      `from_publication_date:${filters.year_from}-01-01`
    );
  }

  if (filters.year_to != null) {
    clauses.push(
      `to_publication_date:${filters.year_to}-12-31`
    );
  }

  if (filters.open_access === true) {
    clauses.push("is_oa:true");
  }

  return clauses.join(",");
}

async function searchOpenAlex() {
  // Desactivado deliberadamente:
  // no forma parte del conjunto clínico profesional visible.
  return [];
}

module.exports = {
  searchOpenAlex,
  buildOpenAlexFilter,
};
