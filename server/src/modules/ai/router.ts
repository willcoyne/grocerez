import { Router } from "express";
import { PricesBody } from "../../contracts/ai.js";
import { uid } from "../../middleware/auth.js";
import { perGroup } from "../../middleware/rateLimit.js";
import { gid } from "../../middleware/requireGroupMember.js";
import { validate } from "../../middleware/validate.js";
import { aiService } from "./service.js";

/** Mounted at /groups/:groupId behind requireGroupMember. */
export const aiRouter = Router({ mergeParams: true });

// POST /recipes/suggest was retired by the Pantry Agent's cited web recipes (challenge 01 §11).

aiRouter.post("/shopping-list/prices", perGroup(20, 60 * 60_000, "prices"), validate({ body: PricesBody }), async (req, res) => {
  res.json(await aiService.prices(gid(req), uid(req), req.body.zipCode));
});
