import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { config } from "../../config.js";
import { AppError } from "../../lib/errors.js";
import { perIp } from "../../middleware/rateLimit.js";
import { agentService } from "./service.js";

/** Constant-time compare (hashing first makes the lengths equal, so timingSafeEqual never throws or leaks length). */
function sameSecret(got: string, expected: string): boolean {
  const a = createHash("sha256").update(got).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

const requireAgentSecret: RequestHandler = (req, _res, next) => {
  const expected = config.AGENT_SHARED_SECRET;
  const got = req.get("x-agent-secret");
  if (!expected || !got || !sameSecret(got, expected)) throw new AppError(401, "UNAUTHENTICATED", "Invalid agent secret");
  next();
};

/** Parsed first so an invalid `proposed` plan can fail the run (422) instead of a plain 400. */
const Envelope = z.object({
  runId: z.uuid(),
  seq: z.number().int().min(0),
  type: z.enum(["step", "proposed", "failed"]),
  payload: z.unknown(),
});

/**
 * Agent → server progress events (agent/API.md). Mounted under /api BEFORE requireAuth: the agent authenticates with
 * X-Agent-Secret, not an app JWT. 204 on success; 409 once the run is no longer running.
 */
export const agentInternalRouter = Router();

agentInternalRouter.post("/internal/agent-events", perIp(600, 60_000), requireAgentSecret, async (req, res) => {
  const envelope = Envelope.parse(req.body ?? {});
  await agentService.handleEvent(envelope, req.body);
  res.status(204).end();
});
