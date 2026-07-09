const express = require("express");
const { requireAuthenticatedUser } = require("../middleware/requireAuthenticatedUser");
const { requireActiveSubscription } = require("../middleware/requireActiveSubscription");
const { workspaceUserRateLimit } = require("../middleware/rateLimit");
const {
  listSearchHistory,
  deleteSearchHistoryItem,
  clearSearchHistory,
  saveArticleToWorkspace,
  listSavedArticles,
  updateSavedArticle,
  removeSavedArticle,
  listCollections,
  renameCollection,
  deleteCollection,
} = require("../services/researchWorkspace");
const {
  getSearchHistoryAudit,
} = require("../services/searchHistoryAuditRepository");

const router = express.Router();

router.use(
  requireAuthenticatedUser,
  workspaceUserRateLimit,
  requireActiveSubscription
);

router.get("/history", async (req, res, next) => {
  try {
    const result = await listSearchHistory(req.user.id, {
      limit: req.query.limit,
      offset: req.query.offset,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/history/:queryId/audit", async (req, res, next) => {
  try {
    const audit = await getSearchHistoryAudit(
      req.user.id,
      req.params.queryId
    );

    if (!audit) {
      return res.status(404).json({ error: "History item not found" });
    }

    return res.json({ audit });
  } catch (error) {
    return next(error);
  }
});

router.delete("/history/:queryId", async (req, res, next) => {
  try {
    const removed = await deleteSearchHistoryItem(
      req.user.id,
      req.params.queryId
    );

    if (!removed) {
      return res.status(404).json({ error: "History item not found" });
    }

    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

router.delete("/history", async (req, res, next) => {
  try {
    const removed = await clearSearchHistory(req.user.id);
    res.json({ success: true, removed });
  } catch (error) {
    next(error);
  }
});

router.post("/save", async (req, res, next) => {
  try {
    const { articleId, collectionName, notes } = req.body || {};

    if (!articleId || typeof articleId !== "string") {
      return res.status(400).json({ error: "articleId is required" });
    }

    const saved = await saveArticleToWorkspace({
      userId: req.user.id,
      articleId,
      collectionName,
      notes,
    });

    return res.status(201).json({ saved });
  } catch (error) {
    return next(error);
  }
});

router.get("/saved", async (req, res, next) => {
  try {
    const result = await listSavedArticles(req.user.id, {
      collectionName: req.query.collection,
      limit: req.query.limit,
      offset: req.query.offset,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.patch("/saved/:articleId", async (req, res, next) => {
  try {
    const saved = await updateSavedArticle({
      userId: req.user.id,
      articleId: req.params.articleId,
      collectionName: req.body?.collectionName,
      notes: req.body?.notes,
    });

    res.json({ saved });
  } catch (error) {
    next(error);
  }
});

router.delete("/saved/:articleId", async (req, res, next) => {
  try {
    const removed = await removeSavedArticle(
      req.user.id,
      req.params.articleId
    );

    if (!removed) {
      return res.status(404).json({ error: "Saved article not found" });
    }

    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

router.get("/collections", async (req, res, next) => {
  try {
    const collections = await listCollections(req.user.id);
    res.json({ collections });
  } catch (error) {
    next(error);
  }
});

router.patch("/collections", async (req, res, next) => {
  try {
    const { currentName, newName } = req.body || {};

    if (!currentName || !newName) {
      return res.status(400).json({
        error: "currentName and newName are required",
      });
    }

    const result = await renameCollection({
      userId: req.user.id,
      currentName,
      newName,
    });

    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.delete("/collections/:collectionName", async (req, res, next) => {
  try {
    const result = await deleteCollection({
      userId: req.user.id,
      collectionName: decodeURIComponent(req.params.collectionName),
      mode: req.query.mode,
    });

    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
