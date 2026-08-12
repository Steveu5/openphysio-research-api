const REQUIRED_ENVIRONMENT_VARIABLES = Object.freeze([
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DEEPSEEK_API_KEY",
]);

const OPTIONAL_ENVIRONMENT_VARIABLES = Object.freeze([
  "ALLOWED_ORIGINS",
  "PORT",
  "DEFAULT_RESULT_LIMIT",
  "CACHE_TTL_HOURS",
  "ANSWER_ARTICLE_LIMIT",
  "DEEPSEEK_TIMEOUT_MS",
  "NCBI_EMAIL",
  "NCBI_API_KEY",
]);

function isConfigured(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function getMissingRequiredEnvironmentVariables(env = process.env) {
  return REQUIRED_ENVIRONMENT_VARIABLES.filter(
    (name) => !isConfigured(env[name])
  );
}

function getConfiguredOptionalEnvironmentVariables(env = process.env) {
  return OPTIONAL_ENVIRONMENT_VARIABLES.filter((name) =>
    isConfigured(env[name])
  );
}

function getAllowedOriginsCount(env = process.env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean).length;
}

function getRuntimeConfigStatus(env = process.env) {
  const missingRequired = getMissingRequiredEnvironmentVariables(env);

  return {
    ready: missingRequired.length === 0,
    environment: env.NODE_ENV || "development",
    missing_required: missingRequired,
    configured_optional: getConfiguredOptionalEnvironmentVariables(env),
    allowed_origins_count: getAllowedOriginsCount(env),
  };
}

function assertRuntimeConfig(env = process.env) {
  const status = getRuntimeConfigStatus(env);

  if (!status.ready) {
    const error = new Error(
      `Missing required environment variables: ${status.missing_required.join(", ")}`
    );
    error.code = "RUNTIME_CONFIG_INVALID";
    error.missingEnvironmentVariables = status.missing_required;
    throw error;
  }

  return status;
}

module.exports = {
  REQUIRED_ENVIRONMENT_VARIABLES,
  OPTIONAL_ENVIRONMENT_VARIABLES,
  getMissingRequiredEnvironmentVariables,
  getConfiguredOptionalEnvironmentVariables,
  getRuntimeConfigStatus,
  assertRuntimeConfig,
};
