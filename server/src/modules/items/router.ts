import { Router } from "express";
import { CreateItemBody, ItemSearchQuery } from "../../contracts/items.js";
import { uid } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { itemsService } from "./service.js";

export const itemsRouter = Router();

itemsRouter.get("/items/search", validate({ query: ItemSearchQuery }), async (req, res) => {
  const { q } = req.query as unknown as { q: string };
  res.json(await itemsService.search(q));
});

itemsRouter.post("/items", validate({ body: CreateItemBody }), async (req, res) => {
  const { item, created } = await itemsService.create(uid(req), req.body);
  res.status(created ? 201 : 200).json(item);
});
