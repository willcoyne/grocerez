import type { Db } from "../../db.js";
import type { FdaRecall } from "../../lib/openfda.js";
import { fdaDate } from "../../lib/openfda.js";

export const MATCH_THRESHOLD = 0.6;
export const MATCH_WINDOW_DAYS = 30;

export const recallsRepo = {
  /** Upsert by external_id (openFDA recall_number), so re-imports never duplicate. */
  upsert: (db: Db, r: FdaRecall) => {
    const data = {
      source: "openfda",
      productDescription: r.product_description.slice(0, 5000),
      reason: r.reason_for_recall ?? null,
      classification: r.classification ?? null,
      firm: r.recalling_firm ?? null,
      distribution: r.distribution_pattern ?? null,
      reportDate: fdaDate(r.report_date),
      status: r.status ?? null,
      raw: r as object,
    };
    return db.recall.upsert({ where: { externalId: r.recall_number }, create: { externalId: r.recall_number, ...data }, update: data });
  },

  /** Latest openFDA report_date we have (the next import starts there). */
  lastReportDate: async (db: Db) =>
    (await db.recall.aggregate({ where: { source: "openfda" }, _max: { reportDate: true } }))._max.reportDate,

  /**
   * Fuzzy-match recalls imported in the last 30 days against cabinet items (optionally one group / one cabinet item).
   * score = max(strict_word_similarity(item name, description), strict_word_similarity(brand + name, description));
   * keep score ≥ 0.6 AND, when the cabinet item's product has a brand, the brand must appear in the description.
   * Inserts new recall_matches (existing ones, including dismissed, are left alone). Returns the affected group ids.
   */
  match: async (db: Db, scope: { groupId?: string; cabinetItemId?: string } = {}) => {
    const groupId = scope.groupId ?? null;
    const cabinetItemId = scope.cabinetItemId ?? null;
    return db.$queryRaw<{ group_id: string }[]>`
      INSERT INTO recall_matches (recall_id, group_id, cabinet_item_id, score)
      SELECT r.id, c.group_id, c.id, s.score
      FROM recalls r
      JOIN cabinet_items c ON (${groupId}::uuid IS NULL OR c.group_id = ${groupId}::uuid)
                          AND (${cabinetItemId}::uuid IS NULL OR c.id = ${cabinetItemId}::uuid)
      JOIN items i ON i.id = c.item_id
      LEFT JOIN products p ON p.id = c.product_id
      CROSS JOIN LATERAL (
        SELECT greatest(
                 strict_word_similarity(i.normalized_name, lower(r.product_description)),
                 coalesce(strict_word_similarity(lower(btrim(coalesce(p.brand, '') || ' ' || p.name)), lower(r.product_description)), 0)
               )::real AS score
      ) s
      WHERE r.created_at >= now() - make_interval(days => ${MATCH_WINDOW_DAYS})
        AND s.score >= ${MATCH_THRESHOLD}
        AND (p.brand IS NULL OR btrim(p.brand) = ''
             OR strpos(lower(r.product_description), lower(btrim(p.brand))) > 0
             OR strpos(lower(coalesce(r.firm, '')), lower(btrim(p.brand))) > 0)
      ON CONFLICT (recall_id, cabinet_item_id) DO NOTHING
      RETURNING group_id`;
  },

  activeMatches: (db: Db, groupId: string) =>
    db.recallMatch.findMany({
      where: { groupId, dismissedAt: null },
      include: {
        recall: true,
        cabinetItem: { include: { item: { select: { name: true } }, product: { select: { brand: true } } } },
      },
      orderBy: [{ createdAt: "desc" }],
    }),

  dismiss: (db: Db, groupId: string, matchId: string) =>
    db.recallMatch.updateMany({ where: { id: matchId, groupId, dismissedAt: null }, data: { dismissedAt: new Date() } }),

  findMatch: (db: Db, groupId: string, matchId: string) => db.recallMatch.findFirst({ where: { id: matchId, groupId } }),
};
