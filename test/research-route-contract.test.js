const test = require("node:test");
const assert = require("node:assert/strict");

const researchRoutes = require("../src/routes/research");
const researchWorkspaceRoutes = require("../src/routes/researchWorkspace");

function getRouteContracts(router) {
  return router.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods).sort(),
    }));
}

test("research router owns only the authenticated scientific search endpoint", () => {
  assert.deepEqual(getRouteContracts(researchRoutes), [
    { path: "/search", methods: ["post"] },
  ]);
});

test("workspace router owns saved articles, history, collections, and audit", () => {
  const contracts = getRouteContracts(researchWorkspaceRoutes);
  const keys = contracts.map(
    ({ path, methods }) => `${methods.join(",").toUpperCase()} ${path}`
  );

  assert.ok(keys.includes("POST /save"));
  assert.ok(keys.includes("GET /saved"));
  assert.ok(keys.includes("GET /history"));
  assert.ok(keys.includes("GET /history/:queryId/audit"));
  assert.ok(keys.includes("GET /collections"));
});
