import { Router } from "express";
import {
  CreatePreferenceBody,
  PreferenceParams,
  PreferencesQuery,
  UpdatePreferenceBody,
} from "../../contracts/preferences.js";
import { validate } from "../../middleware/validate.js";
import * as service from "./service.js";

// Membership is enforced by requireGroupMember in app.ts; req.membership is set there.
export const preferencesRouter = Router();

preferencesRouter.get("/groups/:groupId/preferences", validate({ query: PreferencesQuery }), async (req, res) => {
  res.json(await service.list(req.membership.groupId, req.userId, (req.query as { userId: "me" | "all" }).userId));
});

// Creates or updates the caller's row for (group, user, item); 200 either way.
preferencesRouter.post("/groups/:groupId/preferences", validate({ body: CreatePreferenceBody }), async (req, res) => {
  res.json(await service.upsert(req.membership.groupId, req.userId, req.body));
});

preferencesRouter.patch(
  "/groups/:groupId/preferences/:id",
  validate({ params: PreferenceParams, body: UpdatePreferenceBody }),
  async (req, res) => {
    res.json(await service.update(req.membership.groupId, req.params.id as string, req.userId, req.body));
  },
);

preferencesRouter.delete("/groups/:groupId/preferences/:id", validate({ params: PreferenceParams }), async (req, res) => {
  await service.remove(req.membership.groupId, req.params.id as string, req.userId);
  res.status(204).end();
});
