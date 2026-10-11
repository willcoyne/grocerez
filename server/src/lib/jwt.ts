import jwt from "jsonwebtoken";
import { config } from "../config.js";

/** App session token: { sub: userId }, HS256, 7 days by default. */
export function signAppToken(userId: string, expiresIn: jwt.SignOptions["expiresIn"] = "7d"): string {
  return jwt.sign({}, config.JWT_SECRET, { algorithm: "HS256", subject: userId, expiresIn });
}

function decode(token: string): jwt.JwtPayload | null {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ["HS256"] });
    return typeof payload === "object" && typeof payload.sub === "string" ? payload : null;
  } catch {
    return null;
  }
}

/** Returns the user id of a full app session token, or null if the token is invalid/expired or scoped (e.g. a run token). */
export function verifyAppToken(token: string): string | null {
  const p = decode(token);
  return p && p.scope === undefined ? p.sub! : null;
}

/**
 * Pantry Agent run token (challenge 01): { sub: userId, scope: "agent", runId, groupId }, 15 minutes. requireAuth only
 * accepts it for that group's GET routes and POST /agent/safety-check, and only while the run is `running`.
 */
export function signAgentRunToken(userId: string, runId: string, groupId: string): string {
  return jwt.sign({ scope: "agent", runId, groupId }, config.JWT_SECRET, { algorithm: "HS256", subject: userId, expiresIn: "15m" });
}

export type AgentRunClaims = { userId: string; runId: string; groupId: string };

export function verifyAgentRunToken(token: string): AgentRunClaims | null {
  const p = decode(token);
  if (!p || p.scope !== "agent" || typeof p.runId !== "string" || typeof p.groupId !== "string") return null;
  return { userId: p.sub!, runId: p.runId, groupId: p.groupId };
}
