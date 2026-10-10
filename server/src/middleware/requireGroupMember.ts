import type { RequestHandler } from "express";
import type { GroupRole } from "@prisma/client";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { groupsRepo } from "../modules/groups/repo.js";

declare global {
  namespace Express {
    interface Request {
      membership: { groupId: string; role: GroupRole };
    }
  }
}

const notFound = () => new AppError(404, "NOT_FOUND", "Group not found");

// Mounted on /api/groups/:groupId in app.ts, so every /groups/:groupId/* route passes through it.
// Non-members get 404 so they can't tell whether the group exists.
export const requireGroupMember: RequestHandler = async (req, _res, next) => {
  const groupId = req.params.groupId as string;
  if (!z.uuid().safeParse(groupId).success) throw notFound();
  const role = await groupsRepo.role(groupId, req.userId);
  if (!role) throw notFound();
  req.membership = { groupId, role };
  next();
};

export const requireOwner: RequestHandler = (req, _res, next) => {
  if (req.membership?.role !== "owner") throw new AppError(403, "FORBIDDEN", "Only the group owner can do this");
  next();
};
