function isResearchSearchPath(value = "") {
  return String(value || "").startsWith("/research/search");
}

function isResearchSearchRequest(req = {}) {
  const method = String(req.method || "").toUpperCase();
  const originalUrl = req.originalUrl || req.url || "";

  return method === "POST" && isResearchSearchPath(originalUrl);
}

function isResearchSearchPreflight(req = {}) {
  const method = String(req.method || "").toUpperCase();
  const originalUrl = req.originalUrl || req.url || "";

  return method === "OPTIONS" && isResearchSearchPath(originalUrl);
}

module.exports = {
  isResearchSearchPath,
  isResearchSearchRequest,
  isResearchSearchPreflight,
};
