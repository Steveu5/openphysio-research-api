const test = require("node:test");
const assert = require("node:assert/strict");

const protectedLibraryRoutes = require("../src/routes/protectedLibrary");
const { createApp } = require("../src/server");

test("library router requires authentication and an active subscription", () => {
  const middlewareNames = protectedLibraryRoutes.stack.map(
    (layer) => layer.handle?.name || ""
  );

  assert.deepEqual(middlewareNames.slice(0, 3), [
    "requireAuthenticatedUser",
    "rateLimit",
    "requireActiveSubscription",
  ]);
});

test("unauthenticated library request returns JSON 401 with CORS", async (t) => {
  const app = createApp({
    ...process.env,
    ALLOWED_ORIGINS: "https://app.openphysiohub.com",
  });
  const server = app.listen(0, "127.0.0.1");

  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/library`, {
    headers: {
      Origin: "https://app.openphysiohub.com",
    },
  });

  assert.equal(response.status, 401);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "https://app.openphysiohub.com"
  );

  const payload = await response.json();
  assert.equal(payload.code, "AUTHENTICATION_REQUIRED");
});
