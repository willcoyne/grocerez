import { Router } from "express";
import { AddCabinetBody, CabinetQuery, UpdateCabinetBody } from "../../contracts/cabinet.js";
import { GroupIdParams } from "../../contracts/common.js";
import { uid } from "../../middleware/auth.js";
import { gid } from "../../middleware/requireGroupMember.js";
import { validate } from "../../middleware/validate.js";
import { cabinetService } from "./service.js";

/** Mounted at /groups/:groupId behind requireGroupMember. */
export const cabinetRouter = Router({ mergeParams: true });

cabinetRouter.get("/cabinet", validate({ query: CabinetQuery }), async (req, res) => {
  res.json(await cabinetService.list(gid(req), req.query as never));
});

cabinetRouter.post("/cabinet", validate({ body: AddCabinetBody }), async (req, res) => {
  const { row, created } = await cabinetService.add(gid(req), uid(req), req.body);
  res.status(created ? 201 : 200).json(row);
});

cabinetRouter.patch("/cabinet/:id", validate({ params: GroupIdParams, body: UpdateCabinetBody }), async (req, res) => {
  res.json(await cabinetService.update(gid(req), uid(req), String(req.params.id), req.body));
});

cabinetRouter.post("/cabinet/:id/ran-out", validate({ params: GroupIdParams }), async (req, res) => {
  res.json(await cabinetService.ranOut(gid(req), uid(req), String(req.params.id)));
});

cabinetRouter.delete("/cabinet/:id", validate({ params: GroupIdParams }), async (req, res) => {
  await cabinetService.remove(gid(req), uid(req), String(req.params.id));
  res.status(204).end();
});
