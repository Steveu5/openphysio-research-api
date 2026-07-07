require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const researchWorkspaceRoutes = require("./routes/researchWorkspace");
const researchRoutes = require("./routes/research");
const chatRoutes = require("./routes/chat");
const libraryRoutes = require("./routes/library");
const { sourceDiagnosticsMiddleware } = require("./middleware/sourceDiagnostics");
const { getResearchSystemMetadata } = require("./config/researchSystemVersion");
const {
  assertRuntimeConfig,
  getRuntimeConfigStatus,
} = require("./config/runtimeConfig");
const {
  getAllowedOrigins,
  isOriginAllowed,
} = require("./config/corsOrigins");

function createApp(env = process.env) {
  const app = express();
  const allowedOrigins = getAllowedOrigins(env);

  app.use(helmet());

  app.use(
    cors({
      origin: (origin, callback) => {
        if (isOriginAllowed(origin, allowedOrigins)) {
          return callback(null, true);
        }

        const error = new Error(`CORS blocked for origin: ${origin}`);
        error.status = 403;
        error.code = "CORS_ORIGIN_BLOCKED";
        return callback(error);
      },
      credentials: true,
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type", "Accept"],
      optionsSuccessStatus: 204,
    })
  );

  app.use(express.json({ limit: "2mb" }));
  app.use(sourceDiagnosticsMiddleware);

  app.use((req, res, next) => {
    const metadata = getResearchSystemMetadata();
    res.setHeader("X-OpenPhysio-Algorithm-Version", metadata.algorithm_version);
    res.setHeader("X-OpenPhysio-Ranking-Version", metadata.ranking_version);

    if (req.method === "POST" && req.path === "/research/search") {
      const sendJson = res.json.bind(res);
      res.json = (payload = {}) => sendJson({
        ...payload,
        researchSystem: metadata,
      });
    }

    next();
  });

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "openphysio-research-api",
      timestamp: new Date().toISOString(),
      research_system: getResearchSystemMetadata(),
    });
  });

  app.get("/health/ready", (_req, res) => {
    const runtime = getRuntimeConfigStatus(env);

    res.status(runtime.ready ? 200 : 503).json({
      status: runtime.ready ? "ready" : "not_ready",
      service: "openphysio-research-api",
      timestamp: new Date().toISOString(),
      runtime: {
        ...runtime,
        allowed_origins_count: allowedOrigins.length,
      },
      research_system: getResearchSystemMetadata(),
    });
  });

  app.get("/research/version", (_req, res) => {
    res.json({ research_system: getResearchSystemMetadata() });
  });

  app.use("/research", researchWorkspaceRoutes);
  app.use("/research", researchRoutes);
  app.use("/chat", chatRoutes);
  app.use("/library", libraryRoutes);

  app.use((err, _req, res, _next) => {
    console.error("[API ERROR]", err);
    res.status(err.status || 500).json({
      error: err.message || "Internal server error",
      ...(err.code ? { code: err.code } : {}),
      ...(err.details ? { details: err.details } : {}),
    });
  });

  return app;
}

function startServer({ env = process.env, port = Number(env.PORT || 3000) } = {}) {
  assertRuntimeConfig(env);
  const app = createApp(env);

  return app.listen(port, () => {
    console.log(`OpenPhysio Research API running on port ${port}`);
  });
}

if (require.main === module) {
  try {
    startServer();
  } catch (error) {
    console.error("[STARTUP ERROR]", error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  createApp,
  startServer,
};
