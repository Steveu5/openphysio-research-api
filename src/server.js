require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const researchRoutes = require("./routes/research");

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

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "openphysio-research-api",
    timestamp: new Date().toISOString(),
  });
});

app.use("/research", researchRoutes);

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
