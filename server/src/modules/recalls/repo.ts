import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { logger } from "../../lib/logger.js";
import { MATCH_THRESHOLD, STOP_WORDS } from "./match.js";
import type { Recall } from "./openfda.js";

type Db = Prisma.TransactionClient | typeof prisma;

export const recallsRepo = {
  // Upsert by external_id (openFDA recall_number): re-importing never duplicates. Row by row, so one row the DB
  // rejects is logged and skipped instead of failing the whole import (M3-07). Returns how many rows failed.
  upsert: async (recalls: Recall[]) => {
    let failed = 0;
    for (const { raw, ...r } of recalls) {
      const data = { ...r, raw: raw as Prisma.InputJsonValue };
      await prisma.recall
        .upsert({ where: { externalId: r.externalId }, create: data, update: data, select: { id: true } })
        .catch((err) => {
          failed++;
          logger.warn({ err, externalId: r.externalId }, "recall upsert failed, row skipped");
        });
    }
    return failed;
  },

  /**
   * Scores recalls against cabinet items with pg_trgm strict_word_similarity (DECISIONS "09 (partial, parallel)").
   * Same rule as `matchRecalls` in match.ts: candidate names are item name, aliases and `brand + ' ' + product name`;
   * a name qualifies with score >= 0.35 and all its significant words in the description (whole words, optional
   * trailing "s"); score = best qualifying name; a known brand must pass brandAppears (all words, or a 4+ letter first
   * word). Both sides go through match_norm() (case, accents, apostrophes), like matchNorm() in JS.
   * Match + insert is one statement: `FOR KEY SHARE` locks the matched cabinet item and recall rows, so a concurrent
   * delete either waits or its row is skipped (no FK error), and `ON CONFLICT DO NOTHING` keeps existing/dismissed
   * matches. Returns the groups that got a new match.
   * Scope: `recallsSince` limits recalls by report_date (daily job), `cabinetItemIds` limits items (cabinet add).
   */
  match: async (scope: { recallsSince?: Date; cabinetItemIds?: string[] }, db: Db = prisma): Promise<string[]> => {
    if (scope.cabinetItemIds && !scope.cabinetItemIds.length) return [];
    // ponytail: cross join scored in SQL; fine for a 30-day recall window x household cabinets. Prefilter with the
    // `<<%` GIN operator if cabinets grow to many thousands of rows.
    const rows = await db.$queryRaw<{ group_id: string }[]>`
      INSERT INTO recall_matches (recall_id, cabinet_item_id, group_id, score)
      SELECT r.id, c.id, c.group_id, s.score
      FROM cabinet_items c
      JOIN items i ON i.id = c.item_id
      LEFT JOIN products p ON p.id = c.product_id
      CROSS JOIN recalls r
      CROSS JOIN LATERAL (SELECT match_norm(r.product_description) AS d) rd
      CROSS JOIN LATERAL (
        SELECT max(strict_word_similarity(n, rd.d))::real AS score
        FROM unnest(
          ARRAY[match_norm(i.name), CASE WHEN p.id IS NOT NULL THEN match_norm(COALESCE(p.brand, '') || ' ' || p.name) END]
          || ARRAY(SELECT match_norm(a.alias_normalized) FROM item_aliases a WHERE a.item_id = i.id)
        ) n
        WHERE n IS NOT NULL
          AND strict_word_similarity(n, rd.d) >= ${MATCH_THRESHOLD}
          AND NOT EXISTS (
            SELECT 1 FROM regexp_split_to_table(n, '[^[:alnum:]]+') w
            WHERE length(w) >= 3 AND w <> ALL(${STOP_WORDS}::text[])
              AND rd.d !~ ('\\m' || regexp_replace(w, 's$', '') || 's?\\M'))
      ) s
      CROSS JOIN LATERAL (
        SELECT array_remove(regexp_split_to_array(match_norm(COALESCE(p.brand, '')), '[^[:alnum:]]+'), '') AS bw
      ) b
      WHERE s.score IS NOT NULL
        AND (cardinality(b.bw) = 0
             OR NOT EXISTS (SELECT 1 FROM unnest(b.bw) w WHERE rd.d !~ ('\\m' || regexp_replace(w, 's$', '') || 's?\\M'))
             OR (length(b.bw[1]) >= 4 AND rd.d ~ ('\\m' || regexp_replace(b.bw[1], 's$', '') || 's?\\M')))
        ${scope.recallsSince ? Prisma.sql`AND r.report_date >= ${scope.recallsSince}::date` : Prisma.empty}
        ${scope.cabinetItemIds ? Prisma.sql`AND c.id = ANY(${scope.cabinetItemIds}::uuid[])` : Prisma.empty}
      FOR KEY SHARE OF c, r
      ON CONFLICT (recall_id, cabinet_item_id) DO NOTHING
      RETURNING group_id`;
    return [...new Set(rows.map((r) => r.group_id))];
  },

  openMatches: (groupId: string) =>
    prisma.recallMatch.findMany({
      where: { groupId, dismissedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        cabinetItemId: true,
        score: true,
        createdAt: true,
        recall: true,
        cabinetItem: { select: { item: { select: { id: true, name: true, category: true, defaultAllergens: true, shelfLifeDays: true } } } },
      },
    }),

  // Group-scoped: another group's match id is "not found".
  dismiss: async (groupId: string, id: string) =>
    (await prisma.recallMatch.updateMany({ where: { id, groupId }, data: { dismissedAt: new Date() } })).count > 0,
};
