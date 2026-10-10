import { prisma } from "../../db.js";
import type { AlertsResponse, RecallAlert } from "../../contracts/alerts.js";
import { notFound } from "../../lib/errors.js";
import { groupTimeZone, householdToday, toCalendarDate } from "../../lib/expiration.js";
import { logger } from "../../lib/logger.js";
import { openFda } from "../../lib/openfda.js";
import { emitGroup } from "../../lib/realtime.js";
import { cabinetInclude } from "../cabinet/repo.js";
import { cabinetHooks, toCabinetItem } from "../cabinet/service.js";
import { recallsRepo } from "./repo.js";

const EXPIRING_DAYS = 3;
const FIRST_IMPORT_DAYS = 30;

function notifyGroups(rows: { group_id: string }[]) {
  for (const groupId of new Set(rows.map((r) => r.group_id))) emitGroup(groupId, "cabinet:changed", null);
}

export const recallsService = {
  /**
   * Daily job: import openFDA food enforcement reports since the last import (first run: 30 days back),
   * upsert by recall_number, then fuzzy-match recent recalls against every cabinet. Safe to run repeatedly.
   */
  async importAndMatch(now = new Date()): Promise<{ imported: number; matched: number }> {
    const last = await recallsRepo.lastReportDate(prisma);
    const since = last ?? new Date(now.getTime() - FIRST_IMPORT_DAYS * 24 * 3600 * 1000);
    const recalls = await openFda.enforcementSince(since, now);
    for (const r of recalls) await recallsRepo.upsert(prisma, r);
    const matches = await recallsRepo.match(prisma);
    notifyGroups(matches);
    logger.info({ imported: recalls.length, matched: matches.length }, "recall import finished");
    return { imported: recalls.length, matched: matches.length };
  },

  /** Re-run matching for one cabinet item (called whenever an item is added / bought). Never throws. */
  async matchCabinetItem(groupId: string, cabinetItemId: string): Promise<number> {
    try {
      const rows = await recallsRepo.match(prisma, { groupId, cabinetItemId });
      notifyGroups(rows);
      return rows.length;
    } catch (err) {
      logger.warn({ err }, "recall matching failed");
      return 0;
    }
  },

  async alerts(groupId: string): Promise<AlertsResponse> {
    const horizon = householdToday(await groupTimeZone(prisma, groupId), EXPIRING_DAYS);
    const [expiring, matches] = await Promise.all([
      prisma.cabinetItem.findMany({
        where: { groupId, expiresAt: { lte: horizon } },
        include: cabinetInclude,
        orderBy: [{ expiresAt: "asc" }, { item: { name: "asc" } }],
      }),
      recallsRepo.activeMatches(prisma, groupId),
    ]);
    const recalls: RecallAlert[] = matches.map((m) => ({
      id: m.id,
      score: m.score,
      createdAt: m.createdAt.toISOString(),
      label: "possible match, check your package",
      cabinetItem: {
        id: m.cabinetItem.id,
        itemId: m.cabinetItem.itemId,
        name: m.cabinetItem.item.name,
        brand: m.cabinetItem.product?.brand ?? null,
      },
      recall: {
        id: m.recall.id,
        source: m.recall.source,
        externalId: m.recall.externalId,
        productDescription: m.recall.productDescription,
        reason: m.recall.reason,
        classification: m.recall.classification,
        firm: m.recall.firm,
        distribution: m.recall.distribution,
        reportDate: toCalendarDate(m.recall.reportDate),
        status: m.recall.status,
        url:
          m.recall.source === "openfda"
            ? `https://api.fda.gov/food/enforcement.json?search=recall_number:%22${encodeURIComponent(m.recall.externalId)}%22`
            : null,
      },
    }));
    return { expiring: await Promise.all(expiring.map(toCabinetItem)), recalls };
  },

  /** Dismiss = set dismissed_at (idempotent). 404 if the match isn't in this group. */
  async dismiss(groupId: string, matchId: string, by: string): Promise<void> {
    const m = await recallsRepo.findMatch(prisma, groupId, matchId);
    if (!m) throw notFound("Recall alert");
    const { count } = await recallsRepo.dismiss(prisma, groupId, matchId);
    if (count) emitGroup(groupId, "cabinet:changed", by);
  },
};

// Re-run matching whenever an item is added to (or bought into) a cabinet (backend/09 recalls step 3).
cabinetHooks.afterAdd = async (groupId, cabinetItemId) => {
  await recallsService.matchCabinetItem(groupId, cabinetItemId);
};
