const { getSupabaseAdmin } = require("../services/supabase");

const ACTIVE_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
]);

async function requireActiveSubscription(req, res, next) {
  try {
    if (req.user == null || req.user.id == null) {
      return res.status(401).json({
        error: "Authentication required",
        code: "AUTHENTICATION_REQUIRED",
      });
    }

    const supabase = getSupabaseAdmin();

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("subscription_status,current_period_end")
      .eq("id", req.user.id)
      .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    if (profile == null) {
      return res.status(403).json({
        error: "User profile not found",
        code: "PROFILE_NOT_FOUND",
      });
    }

    const subscriptionStatus = String(
      profile.subscription_status || ""
    ).toLowerCase();

    const hasActiveStatus =
      ACTIVE_SUBSCRIPTION_STATUSES.has(subscriptionStatus);

    let hasValidPeriod = true;

    if (profile.current_period_end) {
      const periodEnd = new Date(profile.current_period_end);

      hasValidPeriod =
        Number.isFinite(periodEnd.getTime()) &&
        periodEnd.getTime() > Date.now();
    }

    if (hasActiveStatus === false || hasValidPeriod === false) {
      return res.status(403).json({
        error: "Active subscription required",
        code: "SUBSCRIPTION_REQUIRED",
        subscription_status: subscriptionStatus || null,
        current_period_end: profile.current_period_end || null,
      });
    }

    req.subscription = {
      status: subscriptionStatus,
      currentPeriodEnd: profile.current_period_end || null,
    };

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  requireActiveSubscription,
};
