import type { Request, RequestHandler } from "express";
import { prisma } from "../db.js";
import { AppError } from "../lib/errors.js";
import { verifyAgentRunToken, verifyAppToken, type AgentRunClaims } from "../lib/jwt.js";

const unauthenticated = () => new AppError(401, "UNAUTHENTICATED", "Sign in required");

const GROUP_PATH = /^\/groups\/([^/]+)(\/.*)?$/;

/**
 * A Pantry Agent run token (lib/jwt signAgentRunToken) works only for its own group's GET routes and
 * POST /groups/:gid/agent/safety-check, and only while its run is still `running` (so it dies with the run).
 * `path` is relative to the /api mount.
 */
async function agentTokenAllowed(run: AgentRunClaims, method: string, path: string): Promise<boolean> {
  const m = GROUP_PATH.exec(path);
  if (!m || m[1].toLowerCase() !== run.groupId.toLowerCase()) return false;
  const rest = (m[2] ?? "").replace(/\/+$/, "");
  if (method !== "GET" && !(method === "POST" && rest === "/agent/safety-check")) return false;
  const live = await prisma.agentRun.count({
    where: { id: run.runId, groupId: run.groupId, userId: run.userId, status: "running" },
  });
  return live === 1;
}

/**
 * Verifies `Authorization: Bearer <appJwt>` and sets req.userId. Also checks the user still exists,
 * so a token for a deleted account (DELETE /me) stops working immediately.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match ? match[1].trim() : "";
  let userId = token ? verifyAppToken(token) : null;
  if (!userId && token) {
    const run = verifyAgentRunToken(token);
    if (run && (await agentTokenAllowed(run, req.method, req.path))) userId = run.userId;
  }
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
