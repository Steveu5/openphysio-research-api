const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  createRateLimiter,
} = require("../src/middleware/rateLimit");

function createResponse() {
  return {
    headers: {},
    statusCode: 200,
    payload: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

function runMiddleware(middleware, req) {
  const res = createResponse();
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  return { res, nextCalled };
}

test("allows requests within the configured limit", () => {
  const limiter = createRateLimiter({
    name: "test",
    windowMs: 60_000,
    max: 2,
  });
  const req = {
    method: "POST",
    user: { id: "user-a" },
    headers: {},
  };

  const first = runMiddleware(limiter, req);
  const second = runMiddleware(limiter, req);

  assert.equal(first.nextCalled, true);
  assert.equal(second.nextCalled, true);
  assert.equal(second.res.headers["RateLimit-Remaining"], "0");
});

test("returns 429 and Retry-After after the limit is exceeded", () => {
  const limiter = createRateLimiter({
    name: "test",
    windowMs: 60_000,
    max: 1,
  });
  const req = {
    method: "POST",
    user: { id: "user-a" },
    headers: {},
  };

  runMiddleware(limiter, req);
  const blocked = runMiddleware(limiter, req);

  assert.equal(blocked.nextCalled, false);
  assert.equal(blocked.res.statusCode, 429);
  assert.equal(blocked.res.payload.code, "RATE_LIMIT_EXCEEDED");
  assert.ok(Number(blocked.res.headers["Retry-After"]) >= 1);
});

test("keeps authenticated users in separate buckets", () => {
  const limiter = createRateLimiter({
    name: "test",
    windowMs: 60_000,
    max: 1,
  });

  const firstUser = runMiddleware(limiter, {
    method: "POST",
    user: { id: "user-a" },
    headers: {},
  });
  const secondUser = runMiddleware(limiter, {
    method: "POST",
    user: { id: "user-b" },
    headers: {},
  });

  assert.equal(firstUser.nextCalled, true);
  assert.equal(secondUser.nextCalled, true);
});

test("skips OPTIONS and HEAD requests", () => {
  const limiter = createRateLimiter({ max: 1 });

  assert.equal(
    runMiddleware(limiter, { method: "OPTIONS", headers: {} }).nextCalled,
    true
  );
  assert.equal(
    runMiddleware(limiter, { method: "HEAD", headers: {} }).nextCalled,
    true
  );
});

test("wires limits after authentication and leaves health routes outside them", () => {
  const root = path.join(__dirname, "..");
  const server = fs.readFileSync(path.join(root, "src/server.js"), "utf8");
  const chat = fs.readFileSync(path.join(root, "src/routes/chat.js"), "utf8");
  const research = fs.readFileSync(
    path.join(root, "src/routes/research.js"),
    "utf8"
  );
  const workspace = fs.readFileSync(
    path.join(root, "src/routes/researchWorkspace.js"),
    "utf8"
  );
  const library = fs.readFileSync(
    path.join(root, "src/routes/protectedLibrary.js"),
    "utf8"
  );

  assert.ok(
    server.indexOf('app.get("/health"') <
      server.indexOf('app.use(["/research", "/chat", "/library"], apiIpRateLimit)')
  );
  assert.match(chat, /requireAuthenticatedUser,\s*chatUserRateLimit/);
  assert.match(research, /requireAuthenticatedUser,\s*researchUserRateLimit/);
  assert.match(workspace, /requireAuthenticatedUser,\s*workspaceUserRateLimit/);
  assert.match(
    library,
    /requireAuthenticatedUser,\s*workspaceUserRateLimit,\s*requireActiveSubscription/
  );
});
