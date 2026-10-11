import { rateLimit } from "express-rate-limit";

const handler = (message: string) => (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
  res.status(429).json({ error: { code: "RATE_LIMITED", message } });

/** Per-IP limit (for unauthenticated routes such as /auth/google). */
export function perIp(limit: number, windowMs: number) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: handler("Too many requests, try again later"),
  });
}

/** Per-signed-in-user limit; mount after requireAuth. `scope` lets one user have separate buckets per feature. */
export function perUser(limit: number, windowMs: number, scope = "") {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => `${scope}:${req.userId ?? "anon"}`,
    handler: handler("Too many requests, try again later"),
  });
}

/** Per-group limit (e.g. recipe suggestions: 10/hour per group); mount after requireGroupMember. */
export function perGroup(limit: number, windowMs: number, scope = "") {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    // requireGroupMember's canonical id, so re-casing the path can't open a fresh bucket.
    keyGenerator: (req) => `${scope}:${req.membership?.groupId ?? String(req.params.groupId).toLowerCase()}`,
    handler: handler("Too many requests for this group, try again later"),
  });
}
