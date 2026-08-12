const { resolveSmokeAccessToken } = require("./smoke-auth-token");

const apiRoot = String(
  process.env.SMOKE_API_ROOT || "https://api.openphysiohub.com"
).replace(/\/+$/, "");

let accessToken = String(process.env.SMOKE_ACCESS_TOKEN || "").trim();
const requireAuthenticated =
  String(process.env.SMOKE_REQUIRE_AUTHENTICATED || "").toLowerCase() === "true";
const runClinical =
  String(process.env.SMOKE_RUN_CLINICAL || "").toLowerCase() === "true";
const standardTimeoutMs = Math.max(
  1000,
  Number(process.env.SMOKE_TIMEOUT_MS || 15000)
);
const clinicalTimeoutMs = Math.max(
  standardTimeoutMs,
  Number(process.env.SMOKE_CLINICAL_TIMEOUT_MS || 90000)
);

function bearerHeaders() {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

async function requestJson(path, {
  method = "GET",
  body,
  headers = {},
  timeoutMs = standardTimeoutMs,
  validate = () => true,
} = {}) {
  const url = `${apiRoot}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const code = payload?.code ? ` (${payload.code})` : "";
      throw new Error(`${path} returned HTTP ${response.status}${code}`);
    }

    if (!validate(payload)) {
      throw new Error(`${path} returned an unexpected payload`);
    }

    console.log(`OK ${method} ${path}`);
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${path} exceeded ${timeoutMs} ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkPublicRuntime() {
  await requestJson("/health", {
    validate: (payload) =>
      payload?.status === "ok" &&
      payload?.service === "openphysio-research-api",
  });

  await requestJson("/health/ready", {
    validate: (payload) =>
      payload?.status === "ready" && payload?.runtime?.ready === true,
  });

  await requestJson("/research/version", {
    validate: (payload) => Boolean(payload?.research_system?.algorithm_version),
  });
}

async function checkAuthenticatedLibrary() {
  const headers = bearerHeaders();
  const catalog = await requestJson("/library", {
    headers,
    validate: (payload) =>
      Array.isArray(payload?.articles) && payload.articles.length > 0,
  });

  const guide = catalog.articles.find((article) => article?.slug);
  if (!guide) throw new Error("/library returned no guide with a slug");

  for (const language of ["es", "en"]) {
    await requestJson(
      `/library/${encodeURIComponent(guide.slug)}/resources?lang=${language}`,
      {
        headers,
        validate: (payload) =>
          payload?.article?.slug === guide.slug &&
          payload?.language === language &&
          typeof payload?.report_html === "string" &&
          payload.report_html.length > 0 &&
          typeof payload?.audio_url === "string" &&
          payload.audio_url.length > 0 &&
          Array.isArray(payload?.infographics) &&
          payload.infographics.length === 4 &&
          payload.infographics.every((item) => Boolean(item?.url)),
      }
    );
  }
}

async function checkClinicalTools() {
  const headers = bearerHeaders();
  const query = "dolor lumbar crónico y ejercicio terapéutico";

  await requestJson("/research/search", {
    method: "POST",
    headers,
    timeoutMs: clinicalTimeoutMs,
    body: { query, filters: {} },
    validate: (payload) =>
      Array.isArray(payload?.articles) &&
      payload.articles.length > 0 &&
      Array.isArray(payload?.structuredResponse?.key_findings) &&
      payload.structuredResponse.key_findings.length > 0 &&
      payload?.researchResponseStructureVersion === "2.0.0",
  });

  await requestJson("/chat/evidence-answer", {
    method: "POST",
    headers,
    timeoutMs: clinicalTimeoutMs,
    body: {
      question: query,
      messages: [],
      filters: {},
      limit: 4,
    },
    validate: (payload) =>
      typeof payload?.reply === "string" &&
      payload.reply.trim().length > 0 &&
      Array.isArray(payload?.sources),
  });
}

async function main() {
  console.log(`Running OpenPhysio smoke checks against ${apiRoot}`);

  await checkPublicRuntime();

  const resolvedAuth = await resolveSmokeAccessToken({
    currentToken: accessToken,
  });
  accessToken = resolvedAuth.token;

  if (resolvedAuth.source === "test_user_login") {
    console.log("OK authenticated a fresh smoke-test user session.");
  }

  if (!accessToken) {
    if (requireAuthenticated || runClinical) {
      throw new Error(
        "Authenticated release checks require SMOKE_ACCESS_TOKEN or SMOKE_TEST_EMAIL + SMOKE_TEST_PASSWORD."
      );
    }
    console.warn(
      "SKIP authenticated Library and clinical checks: no smoke-test user credentials are configured."
    );
    console.warn(
      "For a release gate, set SMOKE_REQUIRE_AUTHENTICATED=true and provide either a token or test-user login credentials."
    );
    console.log("Public production API smoke checks passed.");
    return;
  }

  await checkAuthenticatedLibrary();

  if (runClinical) {
    await checkClinicalTools();
  } else {
    console.warn(
      "SKIP live Chat/Research query: set SMOKE_RUN_CLINICAL=true for the final release gate."
    );
  }

  console.log("Production API smoke checks passed.");
}

main().catch((error) => {
  console.error(`Smoke test failed: ${error.message}`);
  process.exitCode = 1;
});
