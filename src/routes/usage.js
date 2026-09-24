const express = require("express");
const { requireAuthenticatedUser } = require("../middleware/requireAuthenticatedUser");
const { requireActiveSubscription } = require("../middleware/requireActiveSubscription");
const { getUsageSummary } = require("../services/usageQuota");

const router = express.Router();

// The caller's own Chat and Research usage for the current period. The
// client displays exactly this; it never computes periods or limits.
router.get("/", requireAuthenticatedUser, requireActiveSubscription, async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    return res.json(
      await getUsageSummary({
        userId: req.user.id,
        subscriptionStatus: req.subscription?.status,
        currentPeriodEnd: req.subscription?.currentPeriodEnd,
      })
    );
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
