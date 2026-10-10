import { Router } from "express";
import { CreateItemBody, ItemSearchQuery } from "../../contracts/items.js";
import { validate } from "../../middleware/validate.js";
import * as service from "./service.js";

export const itemsRouter = Router();

itemsRouter.get("/items/search", validate({ query: ItemSearchQuery }), async (req, res) => {
  res.json(await service.search((req.query as { q: string }).q));
});

// 200 whether the item is new or already existed (a duplicate name returns the existing item).
itemsRouter.post("/items", validate({ body: CreateItemBody }), async (req, res) => {
  res.json(await service.create(req.body, req.userId));
});
