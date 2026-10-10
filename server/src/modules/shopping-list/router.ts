import { Router } from "express";
import { GroupIdParams } from "../../contracts/common.js";
import { AddListItemBody, CheckListItemBody } from "../../contracts/shoppingList.js";
import { uid } from "../../middleware/auth.js";
import { gid } from "../../middleware/requireGroupMember.js";
import { validate } from "../../middleware/validate.js";
import { shoppingListService } from "./service.js";

/** Mounted at /groups/:groupId behind requireGroupMember. */
export const shoppingListRouter = Router({ mergeParams: true });

shoppingListRouter.get("/shopping-list", async (req, res) => {
  res.json(await shoppingListService.list(gid(req)));
});

shoppingListRouter.post("/shopping-list/generate", async (req, res) => {
  res.json(await shoppingListService.generate(gid(req), uid(req)));
});

shoppingListRouter.post("/shopping-list/complete", async (req, res) => {
  res.json(await shoppingListService.complete(gid(req), uid(req)));
});

shoppingListRouter.post("/shopping-list", validate({ body: AddListItemBody }), async (req, res) => {
  const { row, created } = await shoppingListService.addManual(gid(req), uid(req), req.body);
  res.status(created ? 201 : 200).json(row);
});

shoppingListRouter.patch("/shopping-list/:id", validate({ params: GroupIdParams, body: CheckListItemBody }), async (req, res) => {
  res.json(await shoppingListService.check(gid(req), uid(req), String(req.params.id), req.body));
});

shoppingListRouter.delete("/shopping-list/:id", validate({ params: GroupIdParams }), async (req, res) => {
  await shoppingListService.remove(gid(req), uid(req), String(req.params.id));
  res.status(204).end();
});
