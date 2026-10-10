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

// Verifies `Authorization: Bearer <appJwt>` and sets req.userId.
// Also rejects tokens of users who have since deleted their account.
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const [scheme, token] = req.headers.authorization?.split(" ") ?? [];
  if (scheme !== "Bearer" || !token) throw unauthenticated();
  let sub: unknown;
  try {
    sub = (jwt.verify(token, config.JWT_SECRET, { algorithms: ["HS256"] }) as jwt.JwtPayload).sub;
  } catch {
    throw unauthenticated();
  }
  if (typeof sub !== "string" || !(await usersRepo.exists(sub))) throw unauthenticated();
  req.userId = sub;
  next();
};
