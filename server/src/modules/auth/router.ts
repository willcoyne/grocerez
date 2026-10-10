import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { GoogleLoginBody, UserIdParams, type AuthResponse } from "../../contracts/auth.js";
import { AppError } from "../../lib/errors.js";
import { validate } from "../../middleware/validate.js";
import * as service from "./service.js";

export const authRouter = Router();

const googleLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new AppError(429, "RATE_LIMITED", "Too many sign-in attempts, try again in a minute")),
});

authRouter.post("/auth/google", googleLimiter, validate({ body: GoogleLoginBody }), async (req, res) => {
  const body: AuthResponse = await service.loginWithGoogle(req.body.idToken);
  res.json(body);
});

// Dev-only: sign in as a seeded demo user. Mounted when NODE_ENV !== "production", or in production only when
// DEMO_KEY is set, behind requireDemoKey (see app.ts).
export const devRouter = Router();

const sha256 = (s: string) => createHash("sha256").update(s).digest();
export function requireDemoKey(key: string): RequestHandler {
  const expected = sha256(key);
  return (req, _res, next) => {
    const given = req.get("x-demo-key");
    next(given && timingSafeEqual(sha256(given), expected) ? undefined : new AppError(401, "UNAUTHENTICATED", "Missing or invalid demo key"));
  };
}

devRouter.post("/dev/login-as/:userId", validate({ params: UserIdParams }), async (req, res) => {
  const body: AuthResponse = await service.devLoginAs(req.params.userId as string);
  res.json(body);
});
