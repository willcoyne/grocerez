import { Router } from "express";
import { UpdateMeBody, type User } from "../../contracts/auth.js";
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
