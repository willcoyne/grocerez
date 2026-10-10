import { Router } from "express";
import { DismissParams } from "../../contracts/alerts.js";
import { validate } from "../../middleware/validate.js";
import * as service from "./service.js";

// Membership is enforced by requireGroupMember in app.ts; req.membership is set there.
export const alertsRouter = Router();

alertsRouter.get("/groups/:groupId/alerts", async (req, res) => {
  res.json(await service.alerts(req.membership.groupId));
});

alertsRouter.post("/groups/:groupId/alerts/recalls/:matchId/dismiss", validate({ params: DismissParams }), async (req, res) => {
  await service.dismiss(req.membership.groupId, req.params.matchId as string, req.userId);
  res.status(204).end();
});
