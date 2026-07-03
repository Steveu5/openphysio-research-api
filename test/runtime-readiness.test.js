const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertRuntimeConfig,
  getRuntimeConfigStatus,
} = require("../src/config/runtimeConfig");
const { createApp } = require("../src/server");

const validEnv = {
  NODE_ENV: "test",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  DEEPSEEK_API_KEY: "deepseek-key",
  ALLOWED_ORIGINS: "https://app.example.com",
};

test("runtime readiness reports missing required configuration without exposing values", () => {
  const status = getRuntimeConfigStatus({ NODE_ENV: "test" });

  assert.equal(status.ready, false);
  assert.deepEqual(status.missing_required, [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "DEEPSEEK_API_KEY",
  ]);
  assert.equal(status.environment, "test");
  assert.equal(JSON.stringify(status).includes("service-role"), false);
});

test("runtime readiness accepts a complete production configuration", () => {
  const status = assertRuntimeConfig(validEnv);

  assert.equal(status.ready, true);
  assert.equal(status.allowed_origins_count, 1);
});

test("runtime readiness throws a deployment-friendly startup error", () => {
  assert.throws(
    () => assertRuntimeConfig({ SUPABASE_URL: "https://example.supabase.co" }),
    (error) => {
      assert.equal(error.code, "RUNTIME_CONFIG_INVALID");
      assert.ok(error.message.includes("SUPABASE_SERVICE_ROLE_KEY"));
      assert.ok(error.message.includes("DEEPSEEK_API_KEY"));
      return true;
    }
  );
});

test("health endpoints distinguish liveness from deploy readiness", async (t) => {
  const app = createApp({ NODE_ENV: "test" });
  const server = app.listen(0);
  t.after(() => server.close());

  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();

  const liveResponse = await fetch(`http://127.0.0.1:${port}/health`);
  const readyResponse = await fetch(`http://127.0.0.1:${port}/health/ready`);
  const readyPayload = await readyResponse.json();

  assert.equal(liveResponse.status, 200);
  assert.equal(readyResponse.status, 503);
  assert.equal(readyPayload.status, "not_ready");
  assert.equal(readyPayload.runtime.ready, false);
});
