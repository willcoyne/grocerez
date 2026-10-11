import jwt from "jsonwebtoken";
import { config } from "../config.js";

/** App session token: { sub: userId }, HS256, 7 days. */
export function signAppToken(userId: string): string {
  return jwt.sign({}, config.JWT_SECRET, { algorithm: "HS256", subject: userId, expiresIn: "7d" });
}

/** Returns the user id, or null if the token is invalid/expired. */
export function verifyAppToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ["HS256"] });
    return typeof payload === "object" && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
