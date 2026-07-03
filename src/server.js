require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const researchWorkspaceRoutes = require("./routes/researchWorkspace");
const researchRoutes = require("./routes/research");
const chatRoutes = require("./routes/chat");
const libraryRoutes = require("./routes/library");
const { getResearchSystemMetadata } = require("./config/researchSystemVersion");
const {
  assertRuntimeConfig,
  getRuntimeConfigStatus,
} = require("./config/runtimeConfig");

function createApp(env = process.env) {
  const app = express();
  const allowedOrigins = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(helmet());

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`CORS blocked for origin: ${origin}`));
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: "2mb" }));

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
      runtime,
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
