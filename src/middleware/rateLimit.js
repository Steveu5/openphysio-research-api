const DEFAULT_MAX_ENTRIES = 10_000;

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();

  return forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
}

function defaultKeyGenerator(req) {
  return req.user?.id ? `user:${req.user.id}` : `ip:${normalizeIp(req)}`;
}

function createRateLimiter({
  name = 'api',
  windowMs = 60_000,
  max = 60,
  maxEntries = DEFAULT_MAX_ENTRIES,
  keyGenerator = defaultKeyGenerator,
  skip = (req) => req.method === 'OPTIONS' || req.method === 'HEAD',
} = {}) {
  const safeWindowMs = toPositiveInteger(windowMs, 60_000);
  const safeMax = toPositiveInteger(max, 60);
  const safeMaxEntries = toPositiveInteger(maxEntries, DEFAULT_MAX_ENTRIES);
  const buckets = new Map();

  function prune(now) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }

    if (buckets.size <= safeMaxEntries) return;

    const overflow = buckets.size - safeMaxEntries;
    const oldest = [...buckets.entries()]
      .sort((a, b) => a[1].lastSeen - b[1].lastSeen)
      .slice(0, overflow);

    for (const [key] of oldest) buckets.delete(key);
  }

  return function rateLimit(req, res, next) {
    if (skip(req)) return next();

    const now = Date.now();
    prune(now);

    const identity = String(keyGenerator(req) || defaultKeyGenerator(req));
    const key = `${name}:${identity}`;
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = {
        count: 0,
        resetAt: now + safeWindowMs,
        lastSeen: now,
      };
    }

    bucket.count += 1;
    bucket.lastSeen = now;
    buckets.set(key, bucket);

    const remaining = Math.max(0, safeMax - bucket.count);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.resetAt - now) / 1000)
    );

    res.setHeader('RateLimit-Limit', String(safeMax));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > safeMax) {
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        error: 'Too many requests. Please wait and try again.',
        code: 'RATE_LIMIT_EXCEEDED',
        retry_after_seconds: retryAfterSeconds,
        scope: name,
      });
    }

    return next();
  };
}

const apiIpRateLimit = createRateLimiter({
  name: 'api-ip',
  windowMs: toPositiveInteger(process.env.API_IP_RATE_LIMIT_WINDOW_MS, 60_000),
  max: toPositiveInteger(process.env.API_IP_RATE_LIMIT_MAX, 180),
  keyGenerator: (req) => `ip:${normalizeIp(req)}`,
});

const chatUserRateLimit = createRateLimiter({
  name: 'chat-user',
  windowMs: toPositiveInteger(process.env.CHAT_RATE_LIMIT_WINDOW_MS, 60_000),
  max: toPositiveInteger(process.env.CHAT_RATE_LIMIT_MAX, 12),
});

const researchUserRateLimit = createRateLimiter({
  name: 'research-user',
  windowMs: toPositiveInteger(
    process.env.RESEARCH_RATE_LIMIT_WINDOW_MS,
    5 * 60_000
  ),
  max: toPositiveInteger(process.env.RESEARCH_RATE_LIMIT_MAX, 20),
});

const workspaceUserRateLimit = createRateLimiter({
  name: 'workspace-user',
  windowMs: toPositiveInteger(
    process.env.WORKSPACE_RATE_LIMIT_WINDOW_MS,
    60_000
  ),
  max: toPositiveInteger(process.env.WORKSPACE_RATE_LIMIT_MAX, 120),
});

module.exports = {
  createRateLimiter,
  normalizeIp,
  apiIpRateLimit,
  chatUserRateLimit,
  researchUserRateLimit,
  workspaceUserRateLimit,
};
