const express = require("express");
const libraryRoutes = require("./library");
const {
  requireAuthenticatedUser,
} = require("../middleware/requireAuthenticatedUser");
const {
  requireActiveSubscription,
} = require("../middleware/requireActiveSubscription");

const router = express.Router();

router.use(requireAuthenticatedUser, requireActiveSubscription, libraryRoutes);

module.exports = router;
