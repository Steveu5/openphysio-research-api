require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const researchWorkspaceRoutes = require("./routes/researchWorkspace");
const researchRoutes = require("./routes/research");
const chatRoutes = require("./routes/chat");
const libraryRoutes = require("./routes/library");
const { getResearchSystemMetadata } = require("./config/researchSystemVersion");

const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
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

const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log(`OpenPhysio Research API running on port ${port}`);
});
