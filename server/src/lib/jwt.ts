import jwt from "jsonwebtoken";
import { config } from "../config.js";

/** App session token: { sub: userId }, HS256, 7 days by default (Pantry Agent run tokens use "15m"). */
export function signAppToken(userId: string, expiresIn: jwt.SignOptions["expiresIn"] = "7d"): string {
  return jwt.sign({}, config.JWT_SECRET, { algorithm: "HS256", subject: userId, expiresIn });
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
