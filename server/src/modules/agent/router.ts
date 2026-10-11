import { Router, type Request } from "express";
import { z } from "zod";
import { AgentRunsQuery, RecipeSearchBody, SafetyCheckBody, StartAgentRunBody } from "../../contracts/agent.js";
import { recipeIndex } from "./recipes.js";
import { uid } from "../../middleware/auth.js";
import { perGroup } from "../../middleware/rateLimit.js";
import { gid } from "../../middleware/requireGroupMember.js";
import { validate } from "../../middleware/validate.js";
import { notFound } from "../../lib/errors.js";
import { agentService } from "./service.js";

/** Mounted at /groups/:groupId behind requireGroupMember. */
export const agentRouter = Router({ mergeParams: true });

/** A malformed run id is "not found" (like a run in another group), never a validation error that confirms the route. */
function runId(req: Request): string {
  const id = String(req.params.runId ?? "");
  if (!z.uuid().safeParse(id).success) throw notFound("Agent run");
  return id;
}

agentRouter.post("/agent/runs", perGroup(10, 60 * 60_000, "agent"), validate({ body: StartAgentRunBody }), async (req, res) => {
  res.status(202).json(await agentService.start(gid(req), uid(req), req.body));
});

agentRouter.get("/agent/runs", validate({ query: AgentRunsQuery }), async (req, res) => {
  const { limit } = req.query as unknown as { limit: number };
  res.json(await agentService.list(gid(req), limit));
});

agentRouter.get("/agent/runs/:runId", async (req, res) => {
  res.json(await agentService.get(gid(req), runId(req)));
});

agentRouter.post("/agent/runs/:runId/apply", async (req, res) => {
  res.json(await agentService.apply(gid(req), uid(req), runId(req)));
});

agentRouter.get("/agent/household", async (req, res) => {
  res.json(await agentService.household(gid(req), uid(req)));
});

agentRouter.post("/agent/safety-check", validate({ body: SafetyCheckBody }), async (req, res) => {
  res.json(await agentService.safetyCheck(gid(req), req.body));
});

/** Recipe index search (challenge 01 §12), called by find_recipe with the run token. One Akamai embedding per call. */
agentRouter.post(
  "/agent/recipes/search",
  perGroup(300, 60 * 60_000, "recipe-search"),
  validate({ body: RecipeSearchBody }),
  async (req, res) => {
    res.json(await recipeIndex.search(gid(req), req.body));
  },
);
