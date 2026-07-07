function isResearchSearchRequest(req = {}) {
  const method = String(req.method || "").toUpperCase();
  const originalUrl = req.originalUrl || req.url || "";

  return method === "POST" && originalUrl.startsWith("/research/search");
}

module.exports = {
  isResearchSearchRequest,
};
