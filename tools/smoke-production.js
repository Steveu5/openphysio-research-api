const apiRoot = String(
  process.env.SMOKE_API_ROOT || "https://api.openphysiohub.com"
).replace(/\/+$/, "");

async function checkJson(path, validate) {
  const url = `${apiRoot}${path}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }

  if (!validate(payload)) {
    throw new Error(`${path} returned an unexpected payload`);
  }

  console.log(`OK ${path}`);
}

async function main() {
  console.log(`Running OpenPhysio smoke checks against ${apiRoot}`);

  await checkJson(
    "/health",
    (payload) => payload?.status === "ok" && payload?.service === "openphysio-research-api"
  );

  await checkJson(
    "/health/ready",
    (payload) => payload?.status === "ready" && payload?.runtime?.ready === true
  );

  await checkJson(
    "/research/version",
    (payload) => Boolean(payload?.research_system?.algorithm_version)
  );

  console.log("Production API smoke checks passed.");
}

main().catch((error) => {
  console.error(`Smoke test failed: ${error.message}`);
  process.exitCode = 1;
});
