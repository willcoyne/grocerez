import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { AppError } from "../lib/errors.js";
import { usersRepo } from "../modules/users/repo.js";

declare global {
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

export const signAppToken = (userId: string) =>
  jwt.sign({ sub: userId }, config.JWT_SECRET, { algorithm: "HS256", expiresIn: "7d" });

const unauthenticated = () => new AppError(401, "UNAUTHENTICATED", "Missing or invalid session token");

// Returns the user id for a valid app JWT whose user still exists, otherwise null.
// Shared by requireAuth and the Socket.IO handshake (lib/realtime.ts).
export async function userIdFromToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  let sub: unknown;
  try {
    sub = (jwt.verify(token, config.JWT_SECRET, { algorithms: ["HS256"] }) as jwt.JwtPayload).sub;
  } catch {
    return null;
  }
  return typeof sub === "string" && (await usersRepo.exists(sub)) ? sub : null;
}

// Verifies `Authorization: Bearer <appJwt>` and sets req.userId.
// Also rejects tokens of users who have since deleted their account.
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const [scheme, token] = req.headers.authorization?.split(" ") ?? [];
  const userId = scheme === "Bearer" ? await userIdFromToken(token) : null;
  if (!userId) throw unauthenticated();
  req.userId = userId;
  next();
};
