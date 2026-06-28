// Shared best-effort abuse controls for serverless API routes.
// Note: rate limiting is in-memory per function instance — Vercel may spin up
// multiple instances, so this is a deterrent against casual/scripted abuse,
// not a hard guarantee. Good enough for a demo project's blast radius.

const buckets = new Map(); // ip -> { count, resetAt }
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 15;

export function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

// Anonymous per-browser session token (client-generated UUID, sent via a
// custom header). Used as the rate-limit bucket key when present so that
// multiple users behind the same IP (NAT, office, campus) aren't limited
// together as one bucket. Falls back to IP when absent/invalid.
const SESSION_HEADER = "x-profess-session";
const SESSION_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;

function getRateLimitKey(req) {
  const sessionId = req.headers[SESSION_HEADER];
  if (typeof sessionId === "string" && SESSION_ID_RE.test(sessionId)) {
    return `session:${sessionId}`;
  }
  return `ip:${getClientIp(req)}`;
}

export function isRateLimited(req) {
  const key = getRateLimitKey(req);
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > MAX_PER_WINDOW;
}

// Rejects only when an Origin header is present AND it doesn't match this
// deployment's own host — allows same-origin requests (which sometimes omit
// Origin) through, while blocking obvious cross-site script abuse.
export function isForeignOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const originHost = new URL(origin).host;
    return originHost !== req.headers.host;
  } catch {
    return true;
  }
}
