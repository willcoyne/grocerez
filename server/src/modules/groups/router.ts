import { Router } from "express";
import {
  CreateGroupBody, GroupInviteParams, GroupMemberParams, InviteBody, InviteParams, InvitesQuery, UpdateGroupBody,
} from "../../contracts/groups.js";
import { uid } from "../../middleware/auth.js";
import { perUser } from "../../middleware/rateLimit.js";
import { gid, requireOwner } from "../../middleware/requireGroupMember.js";
import { validate } from "../../middleware/validate.js";
import { groupsService } from "./service.js";

/** Routes not scoped to one group: /groups (list/create), /me/invites, /invites/:inviteId/*. */
export const groupsRouter = Router();

groupsRouter.get("/groups", async (req, res) => {
  res.json(await groupsService.list(uid(req)));
});
groupsRouter.post("/groups", validate({ body: CreateGroupBody }), async (req, res) => {
  res.status(201).json(await groupsService.create(uid(req), req.body.name, req.body.timeZone));
});
groupsRouter.get("/me/invites", async (req, res) => {
  res.json(await groupsService.myInvites(uid(req)));
});
groupsRouter.post("/invites/:inviteId/accept", validate({ params: InviteParams }), async (req, res) => {
  res.json(await groupsService.accept(String(req.params.inviteId), uid(req)));
});
groupsRouter.post("/invites/:inviteId/decline", validate({ params: InviteParams }), async (req, res) => {
  await groupsService.decline(String(req.params.inviteId), uid(req));
  res.status(204).end();
});

/** Mounted at /groups/:groupId behind requireGroupMember. */
export const groupScopedRouter = Router({ mergeParams: true });

groupScopedRouter.get("/", async (req, res) => {
  res.json(await groupsService.get(gid(req), req.membership!.role));
});
groupScopedRouter.patch("/", requireOwner, validate({ body: UpdateGroupBody }), async (req, res) => {
  res.json(await groupsService.rename(gid(req), { name: req.body.name, timeZone: req.body.timeZone }, uid(req)));
});
groupScopedRouter.delete("/", requireOwner, async (req, res) => {
  await groupsService.remove(gid(req), uid(req));
  res.status(204).end();
});

groupScopedRouter.get("/invites", validate({ query: InvitesQuery }), async (req, res) => {
  const { status } = req.query as unknown as { status: "pending" | "all" };
  res.json(await groupsService.listInvites(gid(req), status === "all"));
});
groupScopedRouter.post(
  "/invites",
  perUser(20, 60 * 60_000, "invites"),
  validate({ body: InviteBody }),
  async (req, res) => {
    res.status(201).json(await groupsService.invite(gid(req), uid(req), req.body.email));
  },
);
groupScopedRouter.delete("/invites/:inviteId", validate({ params: GroupInviteParams }), async (req, res) => {
  await groupsService.revokeInvite(gid(req), String(req.params.inviteId), uid(req), req.membership!.role);
  res.status(204).end();
});

groupScopedRouter.post("/leave", async (req, res) => {
  await groupsService.leave(gid(req), uid(req));
  res.status(204).end();
});
groupScopedRouter.delete("/members/:userId", requireOwner, validate({ params: GroupMemberParams }), async (req, res) => {
  await groupsService.removeMember(gid(req), uid(req), String(req.params.userId));
  res.status(204).end();
});
