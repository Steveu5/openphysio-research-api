const DEFAULT_PRODUCTION_ORIGINS = [
  "https://app.openphysiohub.com",
  "https://openphysiohub.com",
  "https://www.openphysiohub.com",
];

function normalizeOrigin(value = "") {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "")
    .toLowerCase();
}

function getAllowedOrigins(env = process.env) {
  const configured = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);

  const includeProductionDefaults =
    String(env.INCLUDE_DEFAULT_PRODUCTION_ORIGINS || "true").toLowerCase() !==
    "false";

  const allOrigins = includeProductionDefaults
    ? [...configured, ...DEFAULT_PRODUCTION_ORIGINS]
    : configured;

  return Array.from(new Set(allOrigins.map(normalizeOrigin).filter(Boolean)));
}

function isOriginAllowed(origin, allowedOrigins = []) {
  if (!origin) return true;
  return allowedOrigins.includes(normalizeOrigin(origin));
}

module.exports = {
  DEFAULT_PRODUCTION_ORIGINS,
  normalizeOrigin,
  getAllowedOrigins,
  isOriginAllowed,
};
