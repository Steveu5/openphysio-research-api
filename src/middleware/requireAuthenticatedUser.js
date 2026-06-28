const { getSupabaseAdmin } = require("../services/supabase");

function getBearerToken(req) {
  const authorization = String(req.headers.authorization || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function requireAuthenticatedUser(req, res, next) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return res.status(401).json({
        error: "Authentication required",
      });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({
        error: "Invalid or expired session",
      });
    }

    req.user = data.user;
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  requireAuthenticatedUser,
};
