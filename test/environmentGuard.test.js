const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  EnvironmentGuardError,
  assertSupabaseAllowed,
  isProductionSupabaseKey,
  isProductionSupabaseUrl,
  resolveAppEnvironment,
  resolveDeepSeekApiKey,
  consumeTestAiCall,
  resetTestAiCallsForTests,
} = require("../src/config/environmentGuard");
const { loadEnvironment } = require("../src/config/loadEnvironment");

// Synthetic values only: unsigned JWT-shaped strings, no real key.
const jwt = (payload) => ["e30", Buffer.from(JSON.stringify(payload)).toString("base64url"), "sig"].join(".");
const PROD_URL = "https://arxstzttwbeytgknxkoa.supabase.co";
const PROD_KEY = jwt({ ref: "arxstzttwbeytgknxkoa", role: "service_role" });
const LOCAL_URL = "http://127.0.0.1:54321";
const LOCAL_KEY = jwt({ iss: "supabase-demo", role: "service_role" });

const code = (fn) => {
  try { fn(); } catch (error) {
    assert.ok(error instanceof EnvironmentGuardError, error.message);
    return error.code;
  }
  return null;
};

test("classifies environments; production stays the default", () => {
  assert.equal(resolveAppEnvironment({}), "production");
  assert.equal(resolveAppEnvironment({ NODE_ENV: "production" }), "production");
  assert.equal(resolveAppEnvironment({ NODE_ENV: "development" }), "development");
  assert.equal(resolveAppEnvironment({ NODE_TEST_CONTEXT: "child-v8" }), "test");
  assert.equal(resolveAppEnvironment({ NODE_ENV: "production", APP_ENV: "test" }), "test");
  assert.equal(code(() => resolveAppEnvironment({ APP_ENV: "staging" })), "unknown_app_env");
  assert.equal(resolveAppEnvironment(process.env), "test", "this suite itself runs as test");
});

test("recognises the production project by URL or by key", () => {
  assert.equal(isProductionSupabaseUrl(PROD_URL), true);
  assert.equal(isProductionSupabaseUrl(LOCAL_URL), false);
  assert.equal(isProductionSupabaseKey(PROD_KEY), true);
  assert.equal(isProductionSupabaseKey(LOCAL_KEY), false);
  assert.equal(isProductionSupabaseKey("not-a-jwt"), false);
});

test("production is untouched", () => {
  assert.equal(assertSupabaseAllowed({ NODE_ENV: "production", SUPABASE_URL: PROD_URL, SUPABASE_SERVICE_ROLE_KEY: PROD_KEY }), "production");
});

test("test never reaches production, even with the opt-in", () => {
  const env = { APP_ENV: "test", ALLOW_PRODUCTION_BACKEND: "true" };
  assert.equal(code(() => assertSupabaseAllowed({ ...env, SUPABASE_URL: PROD_URL, SUPABASE_SERVICE_ROLE_KEY: LOCAL_KEY })), "test_targets_production");
  assert.equal(code(() => assertSupabaseAllowed({ ...env, SUPABASE_URL: LOCAL_URL, SUPABASE_SERVICE_ROLE_KEY: PROD_KEY })), "test_targets_production");
  assert.equal(assertSupabaseAllowed({ APP_ENV: "test", SUPABASE_URL: LOCAL_URL, SUPABASE_SERVICE_ROLE_KEY: LOCAL_KEY }), "test");
});

test("development refuses production unless explicitly opted in", () => {
  const env = { NODE_ENV: "development", SUPABASE_URL: PROD_URL, SUPABASE_SERVICE_ROLE_KEY: PROD_KEY };
  assert.equal(code(() => assertSupabaseAllowed(env)), "development_targets_production");
  assert.equal(assertSupabaseAllowed({ ...env, ALLOW_PRODUCTION_BACKEND: "true" }), "development");
});

test("DeepSeek: production key only in production; separate test key elsewhere", () => {
  assert.equal(resolveDeepSeekApiKey({ NODE_ENV: "production", DEEPSEEK_API_KEY: "prod-synthetic" }), "prod-synthetic");
  assert.equal(code(() => resolveDeepSeekApiKey({ APP_ENV: "test", DEEPSEEK_API_KEY: "prod-synthetic" })), "missing_test_ai_key");
  assert.equal(code(() => resolveDeepSeekApiKey({ APP_ENV: "development", DEEPSEEK_API_KEY: "same", DEEPSEEK_TEST_API_KEY: "same" })), "test_key_equals_production_key");
  assert.equal(resolveDeepSeekApiKey({ APP_ENV: "development", DEEPSEEK_API_KEY: "prod-synthetic", DEEPSEEK_TEST_API_KEY: "test-synthetic" }), "test-synthetic");
});

test("loads only the environment-specific file, never .env, when it exists", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "env-guard-"));
  try {
    fs.writeFileSync(path.join(root, ".env"), `SUPABASE_URL=${PROD_URL}\nSUPABASE_SERVICE_ROLE_KEY=${PROD_KEY}\nDEEPSEEK_API_KEY=prod-synthetic\n`);
    fs.writeFileSync(path.join(root, ".env.development.local"), `SUPABASE_URL=${LOCAL_URL}\nSUPABASE_SERVICE_ROLE_KEY=${LOCAL_KEY}\n`);
    const env = { APP_ENV: "development" };
    assert.deepEqual(loadEnvironment({ root, env }), { appEnv: "development", file: ".env.development.local" });
    assert.equal(env.SUPABASE_URL, LOCAL_URL);
    assert.equal(env.DEEPSEEK_API_KEY, undefined, "production secrets in .env are not loaded");

    // Tests without their own file read nothing: the production .env stays closed.
    const testEnv = { APP_ENV: "test" };
    assert.deepEqual(loadEnvironment({ root, env: testEnv }), { appEnv: "test", file: null });
    assert.equal(testEnv.SUPABASE_URL, undefined);

    // Development without its own file reads the legacy .env, and the guard stops the run.
    fs.rmSync(path.join(root, ".env.development.local"));
    assert.equal(code(() => loadEnvironment({ root, env: { APP_ENV: "development" } })), "development_targets_production");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("caps paid AI calls per process outside production", () => {
  resetTestAiCallsForTests();
  const env = { APP_ENV: "test", DEEPSEEK_TEST_MAX_CALLS: "2" };
  assert.equal(consumeTestAiCall(env), 1);
  assert.equal(consumeTestAiCall(env), 0);
  assert.equal(code(() => consumeTestAiCall(env)), "test_ai_call_budget_exhausted");
  assert.equal(consumeTestAiCall({ NODE_ENV: "production" }), null);
  resetTestAiCallsForTests();
});
