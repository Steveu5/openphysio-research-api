const { getSupabaseAdmin } = require("./supabase");

function getCurrentMonthKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatQuota(row = {}) {
  const used = Number(row.used_count || 0);
  const limit = Number(row.limit_count || 130);

  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    monthKey: row.month_key || getCurrentMonthKey(),
  };
}

function createQuotaExceededError(row) {
  const error = new Error("Chat monthly quota exceeded");
  error.status = 429;
  error.code = "CHAT_QUOTA_EXCEEDED";
  error.details = formatQuota(row);
  return error;
}

async function getOrCreateQuotaRow(userId, monthKey) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("chat_usage")
    .select("id,user_id,month_key,used_count,limit_count,updated_at")
    .eq("user_id", userId)
    .eq("month_key", monthKey)
    .maybeSingle();

  if (error) throw error;
  if (data) return data;

  const { data: inserted, error: insertError } = await supabase
    .from("chat_usage")
    .insert({
      user_id: userId,
      month_key: monthKey,
      used_count: 0,
      limit_count: Number(process.env.CHAT_MONTHLY_LIMIT || 130),
    })
    .select("id,user_id,month_key,used_count,limit_count,updated_at")
    .maybeSingle();

  if (!insertError && inserted) return inserted;

  if (insertError?.code !== "23505") throw insertError;

  const { data: existing, error: retryError } = await supabase
    .from("chat_usage")
    .select("id,user_id,month_key,used_count,limit_count,updated_at")
    .eq("user_id", userId)
    .eq("month_key", monthKey)
    .maybeSingle();

  if (retryError) throw retryError;
  return existing;
}

async function reserveChatQuota(userId) {
  const supabase = getSupabaseAdmin();
  const monthKey = getCurrentMonthKey();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const row = await getOrCreateQuotaRow(userId, monthKey);
    if (!row) throw new Error("Could not initialize chat quota");

    const used = Number(row.used_count || 0);
    const limit = Number(row.limit_count || 130);

    if (used >= limit) throw createQuotaExceededError(row);

    const { data: updated, error } = await supabase
      .from("chat_usage")
      .update({
        used_count: used + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("used_count", used)
      .select("id,user_id,month_key,used_count,limit_count,updated_at")
      .maybeSingle();

    if (error) throw error;
    if (updated) {
      return {
        reservation: {
          id: updated.id,
          userId,
          monthKey,
        },
        quota: formatQuota(updated),
      };
    }
  }

  throw new Error("Could not reserve chat quota after concurrent updates");
}

async function releaseChatQuota(reservation) {
  if (!reservation?.id) return null;

  const supabase = getSupabaseAdmin();
  const { data: current, error: readError } = await supabase
    .from("chat_usage")
    .select("id,used_count,limit_count,month_key")
    .eq("id", reservation.id)
    .maybeSingle();

  if (readError || !current) return null;

  const used = Number(current.used_count || 0);
  if (used <= 0) return formatQuota(current);

  const { data: updated, error } = await supabase
    .from("chat_usage")
    .update({
      used_count: used - 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", reservation.id)
    .eq("used_count", used)
    .select("id,used_count,limit_count,month_key")
    .maybeSingle();

  if (error || !updated) return null;
  return formatQuota(updated);
}

module.exports = {
  getCurrentMonthKey,
  formatQuota,
  reserveChatQuota,
  releaseChatQuota,
};
