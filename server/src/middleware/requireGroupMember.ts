import type { Request, RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { AppError, forbidden } from "../lib/errors.js";
import { groupsRepo } from "../modules/groups/repo.js";

const groupNotFound = () => new AppError(404, "NOT_FOUND", "Group not found");

/**
 * For every /groups/:groupId/* route: the caller must be a member of :groupId.
 * Non-members (and malformed ids) get 404, so the response never reveals that a group exists.
 * Sets req.membership = { groupId, role }.
 */
export const requireGroupMember: RequestHandler = async (req, _res, next) => {
  const groupId = String(req.params.groupId ?? "");
  if (!z.uuid().safeParse(groupId).success || !req.userId) throw groupNotFound();
  const m = await groupsRepo.findMembership(prisma, groupId, req.userId);
  if (!m) throw groupNotFound();
  req.membership = { groupId, role: m.role };
  next();
};

/** Owner-only routes; mount after requireGroupMember. */
export const requireOwner: RequestHandler = (req, _res, next) => {
  if (req.membership?.role !== "owner") throw forbidden("Only the group owner can do that");
  next();
};

/** The verified group id (set by requireGroupMember). */
export function gid(req: Request): string {
  if (!req.membership) throw groupNotFound();
  return req.membership.groupId;
}
