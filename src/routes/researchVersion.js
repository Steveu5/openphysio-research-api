const express = require("express");
const { getResearchSystemManifest } = require("../config/researchSystemVersion");

const router = express.Router();

router.use((req, res, next) => {
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    if (
      req.method === "POST" &&
      req.path === "/search" &&
      body &&
      typeof body === "object" &&
      !Array.isArray(body)
    ) {
      return originalJson({
        ...body,
        system: getResearchSystemManifest(),
      });
    }

    return originalJson(body);
  };

  next();
});

router.get("/version", (_req, res) => {
  res.json({
    system: getResearchSystemManifest({ includeConfig: true }),
  });
});

module.exports = router;
