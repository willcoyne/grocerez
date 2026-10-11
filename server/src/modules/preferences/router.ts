import { Router } from "express";
import { GroupIdParams } from "../../contracts/common.js";
import { CreatePreferenceBody, PreferencesQuery, UpdatePreferenceBody } from "../../contracts/preferences.js";
import { uid } from "../../middleware/auth.js";
import { gid } from "../../middleware/requireGroupMember.js";
import { validate } from "../../middleware/validate.js";
import { preferencesService } from "./service.js";

/** Mounted at /groups/:groupId behind requireGroupMember. */
export const preferencesRouter = Router({ mergeParams: true });

preferencesRouter.get("/preferences", validate({ query: PreferencesQuery }), async (req, res) => {
  const { userId } = req.query as unknown as { userId: "me" | "all" };
  res.json(await preferencesService.list(gid(req), uid(req), userId));
});

preferencesRouter.post("/preferences", validate({ body: CreatePreferenceBody }), async (req, res) => {
  const { pref, created } = await preferencesService.upsert(gid(req), uid(req), req.body);
  res.status(created ? 201 : 200).json(pref);
});

preferencesRouter.patch(
  "/preferences/:id",
  validate({ params: GroupIdParams, body: UpdatePreferenceBody }),
  async (req, res) => {
    res.json(await preferencesService.update(gid(req), uid(req), String(req.params.id), req.body));
  },
);

preferencesRouter.delete("/preferences/:id", validate({ params: GroupIdParams }), async (req, res) => {
  await preferencesService.remove(gid(req), uid(req), String(req.params.id));
  res.status(204).end();
});
