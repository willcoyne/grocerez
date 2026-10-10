import { Router } from "express";
import { CabinetParams, CabinetQuery, CreateCabinetBody, UpdateCabinetBody } from "../../contracts/cabinet.js";
import { validate } from "../../middleware/validate.js";
import * as service from "./service.js";

// Membership is enforced by requireGroupMember in app.ts; req.membership is set there.
export const cabinetRouter = Router();

cabinetRouter.get("/groups/:groupId/cabinet", validate({ query: CabinetQuery }), async (req, res) => {
  res.json(await service.list(req.membership.groupId, req.query as CabinetQuery));
});

// Upsert on (group, item); 200 either way.
cabinetRouter.post("/groups/:groupId/cabinet", validate({ body: CreateCabinetBody }), async (req, res) => {
  res.json(await service.add(req.membership.groupId, req.userId, req.body));
});

cabinetRouter.patch(
  "/groups/:groupId/cabinet/:id",
  validate({ params: CabinetParams, body: UpdateCabinetBody }),
  async (req, res) => {
    res.json(await service.update(req.membership.groupId, req.params.id as string, req.userId, req.body));
  },
);

cabinetRouter.post("/groups/:groupId/cabinet/:id/ran-out", validate({ params: CabinetParams }), async (req, res) => {
  res.json(await service.ranOut(req.membership.groupId, req.params.id as string, req.userId));
});

cabinetRouter.delete("/groups/:groupId/cabinet/:id", validate({ params: CabinetParams }), async (req, res) => {
  await service.remove(req.membership.groupId, req.params.id as string, req.userId);
  res.status(204).end();
});
