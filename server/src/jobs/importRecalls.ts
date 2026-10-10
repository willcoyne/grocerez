import cron from "node-cron";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { logger } from "../lib/logger.js";
import { emitGroup } from "../lib/realtime.js";
import { fetchRecalls } from "../modules/recalls/openfda.js";
import { recallsRepo } from "../modules/recalls/repo.js";

const JOB = "import-recalls";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * backend/09: import openFDA food recalls reported since the last successful import (first run: 30 days back),
 * upsert by recall_number, then match every recall reported in the last 30 days against all cabinets.
 * Groups that got a new possible match receive cabinet:changed (by: "system").
 */
export async function importRecalls(opts: { now?: Date; fetch?: typeof fetch } = {}) {
  const now = opts.now ?? new Date();
  const last = await prisma.jobRun.findUnique({ where: { name: JOB } });
  const since = last?.lastSuccessAt ?? new Date(now.getTime() - 30 * DAY_MS);
  const recalls = await fetchRecalls({ since, until: now, apiKey: config.OPENFDA_API_KEY, fetch: opts.fetch });
  await recallsRepo.upsert(recalls);
  await prisma.jobRun.upsert({ where: { name: JOB }, create: { name: JOB, lastSuccessAt: now }, update: { lastSuccessAt: now } });
  const groups = await recallsRepo.match({ recallsSince: new Date(now.getTime() - 30 * DAY_MS) });
  for (const g of groups) emitGroup(g, "cabinet:changed", "system");
  return { imported: recalls.length, groupsWithNewMatches: groups.length };
}

const run = () =>
  importRecalls()
    .then((r) => logger.info(r, "recall import done"))
    .catch((err) => logger.error({ err }, "recall import failed"));

/** Daily at 06:00 server time; also once now if the last successful run is over a day old (or never happened). */
export async function scheduleRecallImport() {
  cron.schedule("0 6 * * *", run);
  const last = await prisma.jobRun.findUnique({ where: { name: JOB } }).catch(() => null);
  if (!last || Date.now() - last.lastSuccessAt.getTime() > DAY_MS) void run();
}
