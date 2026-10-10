import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { PriceEstimateRequest, RecipeSuggestRequest } from "../../contracts/ai.js";
import { AppError } from "../../lib/errors.js";
import { validate } from "../../middleware/validate.js";
import * as service from "./service.js";

// Membership is enforced by requireGroupMember in app.ts; req.membership is set there.
// Mounted before shoppingListRouter so /shopping-list/prices is matched here, never as /shopping-list/:id.
export const aiRouter = Router();

// ponytail: in-memory per-process store; move to a shared store if the API runs more than one instance.
const recipeLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 10,
  keyGenerator: (req) => req.membership.groupId,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new AppError(429, "RATE_LIMITED", "Too many recipe requests, try again later")),
});

aiRouter.post("/groups/:groupId/recipes/suggest", recipeLimiter, validate({ body: RecipeSuggestRequest }), async (req, res) => {
  res.json(await service.suggestForGroup(req.membership.groupId, req.body));
});

aiRouter.post("/groups/:groupId/shopping-list/prices", validate({ body: PriceEstimateRequest }), async (req, res) => {
  res.json(await service.pricesForGroup(req.membership.groupId, req.userId, req.body));
});
