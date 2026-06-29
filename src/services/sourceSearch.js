function safeErrorMessage(error) {
  const message = String(error?.message || error || "Unknown source error")
    .replace(/\s+/g, " ")
    .trim();

  return message.slice(0, 240);
}

async function runSourceSearch({
  source,
  search,
  fallbackSearch = null,
}) {
  const startedAt = Date.now();
  let retried = false;

  try {
    let articles = await search();

    if ((!Array.isArray(articles) || articles.length === 0) && fallbackSearch) {
      retried = true;
      articles = await fallbackSearch();
    }

    const normalizedArticles = Array.isArray(articles) ? articles : [];

    return {
      articles: normalizedArticles,
      diagnostic: {
        source,
        status: "ok",
        count: normalizedArticles.length,
        duration_ms: Date.now() - startedAt,
        retried,
        error: null,
      },
    };
  } catch (primaryError) {
    if (fallbackSearch) {
      try {
        retried = true;
        const fallbackArticles = await fallbackSearch();
        const normalizedArticles = Array.isArray(fallbackArticles)
          ? fallbackArticles
          : [];

        return {
          articles: normalizedArticles,
          diagnostic: {
            source,
            status: "ok_after_retry",
            count: normalizedArticles.length,
            duration_ms: Date.now() - startedAt,
            retried: true,
            error: safeErrorMessage(primaryError),
          },
        };
      } catch (fallbackError) {
        return {
          articles: [],
          diagnostic: {
            source,
            status: "error",
            count: 0,
            duration_ms: Date.now() - startedAt,
            retried: true,
            error: `${safeErrorMessage(primaryError)} | Retry: ${safeErrorMessage(fallbackError)}`,
          },
        };
      }
    }

    return {
      articles: [],
      diagnostic: {
        source,
        status: "error",
        count: 0,
        duration_ms: Date.now() - startedAt,
        retried,
        error: safeErrorMessage(primaryError),
      },
    };
  }
}

module.exports = {
  runSourceSearch,
  safeErrorMessage,
};
