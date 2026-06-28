function isPlainObject(value) {
  return (
    value != null &&
    typeof value === "object" &&
    Array.isArray(value) === false
  );
}

function firstDefined(...values) {
  return values.find(
    (value) => value !== undefined && value !== null && value !== ""
  );
}

function normalizeYear(value, currentYear) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const year = Number(value);

  if (Number.isInteger(year) === false) {
    return null;
  }

  if (year < 1900 || year > currentYear + 1) {
    return null;
  }

  return year;
}

function normalizeNullableBoolean(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();

  if (
    normalized === "true" ||
    normalized === "1" ||
    normalized === "yes" ||
    normalized === "only" ||
    normalized === "open_access"
  ) {
    return true;
  }

  if (
    normalized === "false" ||
    normalized === "0" ||
    normalized === "no"
  ) {
    return false;
  }

  return null;
}

function normalizeStringArray(value) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  return [
    ...new Set(
      values
        .map((item) => String(item || "").trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
}

function getPresetYears(preset, currentYear) {
  const normalizedPreset = String(preset || "")
    .trim()
    .toLowerCase();

  if (normalizedPreset === "last_5") {
    return {
      year_from: currentYear - 5,
      year_to: null,
    };
  }

  if (normalizedPreset === "last_10") {
    return {
      year_from: currentYear - 10,
      year_to: null,
    };
  }

  if (normalizedPreset === "since_2020") {
    return {
      year_from: 2020,
      year_to: null,
    };
  }

  if (normalizedPreset === "before_2020") {
    return {
      year_from: null,
      year_to: 2019,
    };
  }

  return {
    year_from: null,
    year_to: null,
  };
}

function normalizeResearchFilters(
  requestFilters = {},
  inferredFilters = {},
  currentYear = new Date().getUTCFullYear()
) {
  const explicit = isPlainObject(requestFilters)
    ? requestFilters
    : {};

  const inferred = isPlainObject(inferredFilters)
    ? inferredFilters
    : {};

  const yearPreset = firstDefined(
    explicit.year_preset,
    explicit.yearPreset,
    explicit.year_filter,
    explicit.yearFilter
  );

  const presetYears = getPresetYears(yearPreset, currentYear);

  let yearFrom = normalizeYear(
    firstDefined(
      explicit.year_from,
      explicit.yearFrom,
      presetYears.year_from,
      inferred.year_from,
      inferred.yearFrom
    ),
    currentYear
  );

  let yearTo = normalizeYear(
    firstDefined(
      explicit.year_to,
      explicit.yearTo,
      presetYears.year_to,
      inferred.year_to,
      inferred.yearTo
    ),
    currentYear
  );

  if (yearFrom != null && yearTo != null && yearFrom > yearTo) {
    const previousYearFrom = yearFrom;
    yearFrom = yearTo;
    yearTo = previousYearFrom;
  }

  const openAccess = normalizeNullableBoolean(
    firstDefined(
      explicit.open_access,
      explicit.openAccess,
      inferred.open_access,
      inferred.openAccess
    )
  );

  const studyTypes = normalizeStringArray(
    firstDefined(
      explicit.study_types,
      explicit.studyTypes,
      explicit.evidence_types,
      explicit.evidenceTypes
    )
  );

  return {
    year_from: yearFrom,
    year_to: yearTo,
    open_access: openAccess,
    study_types: studyTypes,
  };
}

function articleMatchesResearchFilters(
  article = {},
  filters = {}
) {
  const year =
    article.year === undefined ||
    article.year === null ||
    article.year === ""
      ? null
      : Number(article.year);

  if (filters.year_from != null) {
    if (
      year === null ||
      Number.isInteger(year) === false ||
      year < Number(filters.year_from)
    ) {
      return false;
    }
  }

  if (filters.year_to != null) {
    if (
      year === null ||
      Number.isInteger(year) === false ||
      year > Number(filters.year_to)
    ) {
      return false;
    }
  }

  if (
    filters.open_access === true &&
    article.open_access !== true
  ) {
    return false;
  }

  return true;
}

module.exports = {
  normalizeResearchFilters,
  articleMatchesResearchFilters,
};
