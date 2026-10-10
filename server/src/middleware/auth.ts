import type { Request, RequestHandler } from "express";
import { prisma } from "../db.js";
import { AppError } from "../lib/errors.js";
import { verifyAppToken } from "../lib/jwt.js";

const unauthenticated = () => new AppError(401, "UNAUTHENTICATED", "Sign in required");

/**
 * Verifies `Authorization: Bearer <appJwt>` and sets req.userId. Also checks the user still exists,
 * so a token for a deleted account (DELETE /me) stops working immediately.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const userId = match ? verifyAppToken(match[1].trim()) : null;
  if (!userId) throw unauthenticated();
  const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!exists) throw unauthenticated();
  req.userId = userId;
  next();
};

/** req.userId for handlers mounted behind requireAuth. */
export function uid(req: Request): string {
  if (!req.userId) throw unauthenticated();
  return req.userId;
}
