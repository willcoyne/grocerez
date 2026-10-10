import { Router } from "express";
import { prisma } from "../../db.js";
import type { HealthResponse } from "../../contracts/common.js";

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  const body: HealthResponse = { ok: true };
  res.json(body);
});
