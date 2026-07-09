const express = require("express");
const libraryRoutes = require("./library");
const {
  requireAuthenticatedUser,
} = require("../middleware/requireAuthenticatedUser");
const {
  requireActiveSubscription,
} = require("../middleware/requireActiveSubscription");
const {
  workspaceUserRateLimit,
} = require("../middleware/rateLimit");

const router = express.Router();

router.use(
  requireAuthenticatedUser,
  workspaceUserRateLimit,
  requireActiveSubscription,
  libraryRoutes
);

module.exports = router;
