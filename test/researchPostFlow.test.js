const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/server");

test("unauthenticated research POST returns JSON instead of closing the socket", async (t) => {
  const app = createApp({
    ...process.env,
    ALLOWED_ORIGINS: "https://app.openphysiohub.com",
  });
  const server = app.listen(0, "127.0.0.1");

  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  const response = await fetch(
    `http://127.0.0.1:${address.port}/research/search`,
    {
      method: "POST",
      headers: {
        Origin: "https://app.openphysiohub.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "dolor" }),
    }
  );

  assert.equal(response.status, 401);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "https://app.openphysiohub.com"
  );

  const payload = await response.json();
  assert.equal(payload.error, "Authentication required");
  assert.ok(payload.researchSystem);
});
