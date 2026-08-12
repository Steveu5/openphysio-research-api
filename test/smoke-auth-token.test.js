const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveSmokeAccessToken,
} = require("../tools/smoke-auth-token");

test("uses an explicitly supplied smoke token without creating a Supabase client", async () => {
  let clientCreated = false;
  const result = await resolveSmokeAccessToken({
    currentToken: " direct-token ",
    env: {},
    clientFactory: () => {
      clientCreated = true;
      throw new Error("client should not be created");
    },
  });

  assert.deepEqual(result, {
    token: "direct-token",
    source: "provided",
  });
  assert.equal(clientCreated, false);
});

test("returns no token when no authenticated smoke credentials are configured", async () => {
  const result = await resolveSmokeAccessToken({
    env: {},
    clientFactory: () => {
      throw new Error("client should not be created");
    },
  });

  assert.deepEqual(result, { token: "", source: "none" });
});

test("requires both smoke test email and password", async () => {
  await assert.rejects(
    resolveSmokeAccessToken({
      env: { SMOKE_TEST_EMAIL: "clinician@example.com" },
    }),
    /Both SMOKE_TEST_EMAIL and SMOKE_TEST_PASSWORD/
  );
});

test("creates a dedicated server auth client and returns a fresh user session", async () => {
  let receivedUrl = null;
  let receivedKey = null;
  let receivedOptions = null;
  let receivedCredentials = null;

  const result = await resolveSmokeAccessToken({
    env: {
      SMOKE_TEST_EMAIL: " clinician@example.com ",
      SMOKE_TEST_PASSWORD: "test-password",
      SUPABASE_URL: " https://example.supabase.co ",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    },
    clientFactory: (url, key, options) => {
      receivedUrl = url;
      receivedKey = key;
      receivedOptions = options;
      return {
        auth: {
          signInWithPassword: async (credentials) => {
            receivedCredentials = credentials;
            return {
              data: {
                session: {
                  access_token: " fresh-user-token ",
                },
              },
              error: null,
            };
          },
        },
      };
    },
  });

  assert.equal(receivedUrl, "https://example.supabase.co");
  assert.equal(receivedKey, "service-role-key");
  assert.deepEqual(receivedOptions, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  assert.deepEqual(receivedCredentials, {
    email: "clinician@example.com",
    password: "test-password",
  });
  assert.deepEqual(result, {
    token: "fresh-user-token",
    source: "test_user_login",
  });
});

test("surfaces Supabase login failures without leaking credentials", async () => {
  await assert.rejects(
    resolveSmokeAccessToken({
      env: {
        SMOKE_TEST_EMAIL: "clinician@example.com",
        SMOKE_TEST_PASSWORD: "secret-password",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      },
      clientFactory: () => ({
        auth: {
          signInWithPassword: async () => ({
            data: null,
            error: { message: "Invalid login credentials" },
          }),
        },
      }),
    }),
    (error) => {
      assert.match(error.message, /Invalid login credentials/);
      assert.doesNotMatch(error.message, /secret-password/);
      assert.doesNotMatch(error.message, /clinician@example\.com/);
      return true;
    }
  );
});
