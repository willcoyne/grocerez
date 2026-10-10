import { Router } from "express";
import { AddListItemBody, CheckListItemBody, ListItemParams } from "../../contracts/shoppingList.js";
import { validate } from "../../middleware/validate.js";
import * as service from "./service.js";

// Membership is enforced by requireGroupMember in app.ts; req.membership is set there.
export const shoppingListRouter = Router();
const base = "/groups/:groupId/shopping-list";

shoppingListRouter.get(base, async (req, res) => {
  res.json(await service.list(req.membership.groupId));
});

shoppingListRouter.post(`${base}/generate`, async (req, res) => {
  res.json(await service.regenerateNow(req.membership.groupId, req.userId));
});

shoppingListRouter.post(`${base}/complete`, async (req, res) => {
  res.json(await service.complete(req.membership.groupId, req.userId));
});

// Manual add, upsert on (group, item); 200 either way.
shoppingListRouter.post(base, validate({ body: AddListItemBody }), async (req, res) => {
  res.json(await service.addManual(req.membership.groupId, req.userId, req.body));
});

shoppingListRouter.patch(`${base}/:id`, validate({ params: ListItemParams, body: CheckListItemBody }), async (req, res) => {
  res.json(await service.check(req.membership.groupId, req.params.id as string, req.userId, req.body));
});

shoppingListRouter.delete(`${base}/:id`, validate({ params: ListItemParams }), async (req, res) => {
  await service.remove(req.membership.groupId, req.params.id as string, req.userId);
  res.status(204).end();
});
