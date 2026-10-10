import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import {
  CreateInviteBody,
  GroupInviteParams,
  GroupMemberParams,
  GroupNameBody,
  InviteParams,
  InvitesQuery,
} from "../../contracts/groups.js";
import { AppError } from "../../lib/errors.js";
import { requireOwner } from "../../middleware/requireGroupMember.js";
import { validate } from "../../middleware/validate.js";
import * as service from "./service.js";

// Membership on /groups/:groupId/* is enforced by requireGroupMember in app.ts; req.membership is set there.
export const groupsRouter = Router();

const inviteLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 20,
  keyGenerator: (req) => req.userId,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new AppError(429, "RATE_LIMITED", "Too many invites, try again later")),
});

groupsRouter.get("/groups", async (req, res) => {
  res.json(await service.listGroups(req.userId));
});

groupsRouter.post("/groups", validate({ body: GroupNameBody }), async (req, res) => {
  res.status(201).json(await service.createGroup(req.userId, req.body.name));
});

groupsRouter.get("/groups/:groupId", async (req, res) => {
  res.json(await service.getGroup(req.membership.groupId, req.membership.role));
});

groupsRouter.patch("/groups/:groupId", requireOwner, validate({ body: GroupNameBody }), async (req, res) => {
  res.json(await service.renameGroup(req.membership.groupId, req.membership.role, req.body.name, req.userId));
});

groupsRouter.delete("/groups/:groupId", requireOwner, async (req, res) => {
  await service.deleteGroup(req.membership.groupId, req.userId);
  res.status(204).end();
});

groupsRouter.get("/groups/:groupId/invites", validate({ query: InvitesQuery }), async (req, res) => {
  res.json(await service.listInvites(req.membership.groupId, (req.query as { status: string }).status === "all"));
});

groupsRouter.post("/groups/:groupId/invites", inviteLimiter, validate({ body: CreateInviteBody }), async (req, res) => {
  res.status(201).json(await service.invite(req.membership.groupId, req.body.email, req.userId));
});

groupsRouter.delete("/groups/:groupId/invites/:inviteId", validate({ params: GroupInviteParams }), async (req, res) => {
  await service.revokeInvite(req.membership.groupId, req.params.inviteId as string, req.userId, req.membership.role);
  res.status(204).end();
});

groupsRouter.post("/groups/:groupId/leave", async (req, res) => {
  await service.leaveGroup(req.membership.groupId, req.userId);
  res.status(204).end();
});

groupsRouter.delete("/groups/:groupId/members/:userId", requireOwner, validate({ params: GroupMemberParams }), async (req, res) => {
  await service.removeMember(req.membership.groupId, req.params.userId as string, req.userId);
  res.status(204).end();
});

groupsRouter.get("/me/invites", async (req, res) => {
  res.json(await service.myInvites(req.userId));
});

groupsRouter.post("/invites/:inviteId/accept", validate({ params: InviteParams }), async (req, res) => {
  res.json(await service.acceptInvite(req.params.inviteId as string, req.userId));
});

groupsRouter.post("/invites/:inviteId/decline", validate({ params: InviteParams }), async (req, res) => {
  await service.declineInvite(req.params.inviteId as string, req.userId);
  res.status(204).end();
});
