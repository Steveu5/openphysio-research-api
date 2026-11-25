// Separates development, test and production for the Research API and stops
// any non-production run from touching production data or paid credentials.
//
//   production  -> NODE_ENV=production (Dockerfile) or NODE_ENV unset. Unchanged.
//   development -> NODE_ENV=development or APP_ENV=development.
//   test        -> `node --test` (NODE_TEST_CONTEXT), NODE_ENV=test or APP_ENV=test.
//
// Outside production:
//   * the production Supabase project (URL or service-role key) is refused;
//     only `development` may opt in with ALLOW_PRODUCTION_BACKEND=true, `test` never;
//   * DeepSeek uses DEEPSEEK_TEST_API_KEY only. DEEPSEEK_API_KEY (production) is
//     never read, so a missing test key means no paid AI call at all.
// Secrets are never logged; errors name variables, not values.

const PRODUCTION_SUPABASE_REF = "arxstzttwbeytgknxkoa";
const ENVIRONMENTS = Object.freeze(["development", "test", "production"]);

class EnvironmentGuardError extends Error {
  constructor(code, message) {
    super(`[environment guard] ${message}`);
    this.name = "EnvironmentGuardError";
    this.code = code;
  }
}

function resolveAppEnvironment(env = process.env) {
  const explicit = String(env.APP_ENV || "").trim().toLowerCase();
  if (explicit) {
    if (!ENVIRONMENTS.includes(explicit)) {
      throw new EnvironmentGuardError("unknown_app_env", `APP_ENV="${explicit}" must be one of ${ENVIRONMENTS.join(", ")}.`);
    }
    return explicit;
  }
  if (env.NODE_TEST_CONTEXT) return "test";
  const nodeEnv = String(env.NODE_ENV || "").trim().toLowerCase();
  if (nodeEnv === "test") return "test";
  if (nodeEnv === "development") return "development";
  return "production";
}

function isProductionSupabaseUrl(url) {
  try {
    const host = new URL(String(url || "")).hostname.toLowerCase();
    return host === `${PRODUCTION_SUPABASE_REF}.supabase.co` || host.startsWith(`${PRODUCTION_SUPABASE_REF}.`);
  } catch {
    return false;
  }
}

// Supabase keys are JWTs whose payload names the project (`ref`). Local keys have none.
function isProductionSupabaseKey(key) {
  const parts = String(key || "").split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload?.ref === PRODUCTION_SUPABASE_REF;
  } catch {
    return false;
  }
}

function assertSupabaseAllowed(env = process.env) {
  const appEnv = resolveAppEnvironment(env);
  if (appEnv === "production") return appEnv;
  const touchesProduction = isProductionSupabaseUrl(env.SUPABASE_URL)
    || isProductionSupabaseKey(env.SUPABASE_SERVICE_ROLE_KEY)
    || isProductionSupabaseKey(env.SUPABASE_ANON_KEY);
  if (!touchesProduction) return appEnv;
  const optedIn = appEnv === "development" && String(env.ALLOW_PRODUCTION_BACKEND || "").trim() === "true";
  if (optedIn) return appEnv;
  throw new EnvironmentGuardError(
    `${appEnv}_targets_production`,
    `The ${appEnv} environment is configured with the production Supabase project. `
      + `Use .env.${appEnv}.local with the local Supabase (http://127.0.0.1:54321) and its local keys `
      + "(see docs/ENVIRONMENTS.md)."
  );
}

function resolveDeepSeekApiKey(env = process.env) {
  const appEnv = resolveAppEnvironment(env);
  if (appEnv === "production") {
    const key = String(env.DEEPSEEK_API_KEY || "").trim();
    if (!key) throw new Error("Missing DEEPSEEK_API_KEY");
    return key;
  }
  const key = String(env.DEEPSEEK_TEST_API_KEY || "").trim();
  if (!key) {
    throw new EnvironmentGuardError(
      "missing_test_ai_key",
      `Missing DEEPSEEK_TEST_API_KEY. The ${appEnv} environment never uses the production DEEPSEEK_API_KEY, `
        + "so no paid AI call is made without a separate, spend-limited test key."
    );
  }
  if (key === String(env.DEEPSEEK_API_KEY || "").trim()) {
    throw new EnvironmentGuardError("test_key_equals_production_key", "DEEPSEEK_TEST_API_KEY must be a different key from DEEPSEEK_API_KEY.");
  }
  return key;
}

// Extra brake outside production: at most DEEPSEEK_TEST_MAX_CALLS paid calls per
// process (default 20). DeepSeek has no per-key spending cap, so the real hard
// limit is the prepaid balance of a separate test account (docs/ENVIRONMENTS.md).
let testAiCalls = 0;
function consumeTestAiCall(env = process.env) {
  if (resolveAppEnvironment(env) === "production") return null;
  const configured = Number.parseInt(String(env.DEEPSEEK_TEST_MAX_CALLS || "20"), 10);
  const max = Number.isFinite(configured) && configured >= 0 ? configured : 20;
  if (testAiCalls >= max) {
    throw new EnvironmentGuardError("test_ai_call_budget_exhausted", `Reached DEEPSEEK_TEST_MAX_CALLS=${max} paid AI calls in this process.`);
  }
  testAiCalls += 1;
  return max - testAiCalls;
}
function resetTestAiCallsForTests() { testAiCalls = 0; }

function assertSafeEnvironment(env = process.env) {
  const appEnv = assertSupabaseAllowed(env);
  return { appEnv };
}

module.exports = {
  PRODUCTION_SUPABASE_REF,
  EnvironmentGuardError,
  resolveAppEnvironment,
  isProductionSupabaseUrl,
  isProductionSupabaseKey,
  assertSupabaseAllowed,
  resolveDeepSeekApiKey,
  consumeTestAiCall,
  resetTestAiCallsForTests,
  assertSafeEnvironment,
};
