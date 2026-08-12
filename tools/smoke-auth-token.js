const { createClient } = require("@supabase/supabase-js");

function clean(value) {
  return String(value || "").trim();
}

async function resolveSmokeAccessToken({
  currentToken,
  env = process.env,
  clientFactory = createClient,
} = {}) {
  const directToken = clean(currentToken || env.SMOKE_ACCESS_TOKEN);
  if (directToken) {
    return { token: directToken, source: "provided" };
  }

  const email = clean(env.SMOKE_TEST_EMAIL);
  const password = clean(env.SMOKE_TEST_PASSWORD);

  if (!email && !password) {
    return { token: "", source: "none" };
  }

  if (!email || !password) {
    throw new Error(
      "Both SMOKE_TEST_EMAIL and SMOKE_TEST_PASSWORD are required to create a fresh smoke-test session."
    );
  }

  const supabaseUrl = clean(env.SUPABASE_URL);
  const serviceRoleKey = clean(env.SUPABASE_SERVICE_ROLE_KEY);

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to authenticate the smoke-test user."
    );
  }

  // Use a dedicated server-side client. Auth functions replace the client's
  // Authorization header with the returned user session, so this client must
  // never be reused for service-role database or Storage operations.
  const authClient = clientFactory(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await authClient.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error(`Unable to authenticate smoke-test user: ${error.message}`);
  }

  const token = clean(data?.session?.access_token);
  if (!token) {
    throw new Error(
      "Smoke-test user authenticated without returning an access token."
    );
  }

  return { token, source: "test_user_login" };
}

module.exports = {
  resolveSmokeAccessToken,
};
