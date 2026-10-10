import { Router } from "express";
import { UpdateMeBody, type User } from "../../contracts/auth.js";
import { PutDietaryBody } from "../../contracts/dietary.js";
import { validate } from "../../middleware/validate.js";
import * as service from "./service.js";

export const usersRouter = Router();

usersRouter.get("/me", async (req, res) => {
  const body: User = await service.getMe(req.userId);
  res.json(body);
});

usersRouter.patch("/me", validate({ body: UpdateMeBody }), async (req, res) => {
  const body: User = await service.updateMe(req.userId, req.body);
  res.json(body);
});

usersRouter.delete("/me", async (req, res) => {
  const body: User = await service.deleteMe(req.userId);
  res.json(body);
});

usersRouter.get("/me/dietary", async (req, res) => {
  res.json(await service.getDietary(req.userId));
});

usersRouter.put("/me/dietary", validate({ body: PutDietaryBody }), async (req, res) => {
  res.json(await service.setDietary(req.userId, req.body));
});
