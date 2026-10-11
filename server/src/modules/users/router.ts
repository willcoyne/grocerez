import { Router } from "express";
import { z } from "zod";
import { config } from "../../config.js";
import { GoogleAuthBody, UpdateMeBody } from "../../contracts/auth.js";
import { AppError } from "../../lib/errors.js";
import { uid } from "../../middleware/auth.js";
import { perIp } from "../../middleware/rateLimit.js";
import { validate } from "../../middleware/validate.js";
import { usersService } from "./service.js";

/** Public: POST /auth/google (20 requests/min per IP). */
export const authRouter = Router();
authRouter.post("/auth/google", perIp(20, 60_000), validate({ body: GoogleAuthBody }), async (req, res) => {
  res.json(await usersService.signInWithGoogle(req.body.idToken));
});

/** GET / PATCH / DELETE /me (mounted behind requireAuth). */
export const meRouter = Router();
meRouter.get("/me", async (req, res) => {
  res.json(await usersService.getMe(uid(req)));
});
meRouter.patch("/me", validate({ body: UpdateMeBody }), async (req, res) => {
  res.json(await usersService.updateMe(uid(req), req.body));
});
meRouter.delete("/me", async (req, res) => {
  await usersService.deleteMe(uid(req));
  res.status(204).end();
});

/**
 * POST /dev/login-as/:userId: a session for a seeded demo user (database/10 step 9).
 * Mounted when NODE_ENV !== "production". In production it is mounted only if DEMO_KEY is set,
 * and then requires header `x-demo-key: <DEMO_KEY>` (backend/12 step 4).
 */
export function devRouter() {
  const router = Router();
  if (config.NODE_ENV === "production" && !config.DEMO_KEY) return router;
  router.post(
    "/dev/login-as/:userId",
    perIp(30, 60_000),
    validate({ params: z.object({ userId: z.uuid() }) }),
    async (req, res) => {
      if (config.NODE_ENV === "production" && req.get("x-demo-key") !== config.DEMO_KEY) {
        throw new AppError(404, "NOT_FOUND", "Not found");
      }
      res.json(await usersService.loginAs(String(req.params.userId)));
    },
  );
  return router;
}
