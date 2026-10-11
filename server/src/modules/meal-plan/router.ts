import { Router, type Request } from "express";
import { z } from "zod";
import { AddPlannedMealBody, MealPlanQuery, MovePlannedMealBody } from "../../contracts/mealPlan.js";
import { notFound } from "../../lib/errors.js";
import { uid } from "../../middleware/auth.js";
import { gid } from "../../middleware/requireGroupMember.js";
import { validate } from "../../middleware/validate.js";
import { mealPlanService } from "./service.js";

/** Week calendar (challenge 01 §13). Mounted at /groups/:groupId behind requireGroupMember. */
export const mealPlanRouter = Router({ mergeParams: true });

/** A malformed id is "not found", like a planned meal in another group. */
function plannedId(req: Request): string {
  const id = String(req.params.id ?? "");
  if (!z.uuid().safeParse(id).success) throw notFound("Planned meal");
  return id;
}

mealPlanRouter.get("/meal-plan", validate({ query: MealPlanQuery }), async (req, res) => {
  res.json(await mealPlanService.list(gid(req), req.query as { from?: string; to?: string }));
});

mealPlanRouter.post("/meal-plan", validate({ body: AddPlannedMealBody }), async (req, res) => {
  res.status(201).json(await mealPlanService.add(gid(req), uid(req), req.body));
});

mealPlanRouter.patch("/meal-plan/:id", validate({ body: MovePlannedMealBody }), async (req, res) => {
  res.json(await mealPlanService.move(gid(req), uid(req), plannedId(req), req.body.date));
});

mealPlanRouter.delete("/meal-plan/:id", async (req, res) => {
  await mealPlanService.remove(gid(req), uid(req), plannedId(req));
  res.status(204).end();
});

mealPlanRouter.post("/meal-plan/:id/add-missing", async (req, res) => {
  res.json(await mealPlanService.addMissing(gid(req), uid(req), plannedId(req)));
});
