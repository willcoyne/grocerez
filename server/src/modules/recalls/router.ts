import { Router } from "express";
import { DismissParams } from "../../contracts/alerts.js";
import { uid } from "../../middleware/auth.js";
import { gid } from "../../middleware/requireGroupMember.js";
import { validate } from "../../middleware/validate.js";
import { recallsService } from "./service.js";

/** Mounted at /groups/:groupId behind requireGroupMember. */
export const alertsRouter = Router({ mergeParams: true });

alertsRouter.get("/alerts", async (req, res) => {
  res.json(await recallsService.alerts(gid(req)));
});

alertsRouter.post("/alerts/recalls/:matchId/dismiss", validate({ params: DismissParams }), async (req, res) => {
  await recallsService.dismiss(gid(req), String(req.params.matchId), uid(req));
  res.status(204).end();
});
