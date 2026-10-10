import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { brandAppears, MATCH_THRESHOLD } from "./match.js";
import type { Recall } from "./openfda.js";

type Db = Prisma.TransactionClient | typeof prisma;
type Scored = { recall_id: string; cabinet_item_id: string; group_id: string; brand: string | null; product_description: string; score: number };

export const recallsRepo = {
  // Upsert by external_id (openFDA recall_number): re-importing never duplicates.
  upsert: (recalls: Recall[]) =>
    prisma.$transaction(
      recalls.map(({ raw, ...r }) => {
        const data = { ...r, raw: raw as Prisma.InputJsonValue };
        return prisma.recall.upsert({ where: { externalId: r.externalId }, create: data, update: data, select: { id: true } });
      }),
    ),

  /**
   * Scores recalls against cabinet items with pg_trgm strict_word_similarity (DECISIONS "09 (partial, parallel)"):
   * best of item name, aliases and `brand + ' ' + product name`. A match needs score >= 0.35 and, when the brand is
   * known, the brand as whole words in the description. Inserts new matches only; returns the groups that got one.
   * Scope: `recallsSince` limits recalls by report_date (daily job), `cabinetItemIds` limits items (cabinet add).
   */
  match: async (scope: { recallsSince?: Date; cabinetItemIds?: string[] }, db: Db = prisma): Promise<string[]> => {
    if (scope.cabinetItemIds && !scope.cabinetItemIds.length) return [];
    // ponytail: cross join scored in SQL; fine for a 30-day recall window x household cabinets. Prefilter with the
    // `<<%` GIN operator if cabinets grow to many thousands of rows.
    const rows = await db.$queryRaw<Scored[]>`
      SELECT * FROM (
        SELECT r.id AS recall_id, c.id AS cabinet_item_id, c.group_id, p.brand, r.product_description,
          GREATEST(
            strict_word_similarity(i.name, r.product_description),
            COALESCE((SELECT max(strict_word_similarity(a.alias_normalized, r.product_description))
                      FROM item_aliases a WHERE a.item_id = i.id), 0),
            CASE WHEN p.id IS NULL THEN 0
                 ELSE strict_word_similarity(COALESCE(p.brand, '') || ' ' || p.name, r.product_description) END
          )::float8 AS score
        FROM cabinet_items c
        JOIN items i ON i.id = c.item_id
        LEFT JOIN products p ON p.id = c.product_id
        CROSS JOIN recalls r
        WHERE TRUE
          ${scope.recallsSince ? Prisma.sql`AND r.report_date >= ${scope.recallsSince}::date` : Prisma.empty}
          ${scope.cabinetItemIds ? Prisma.sql`AND c.id = ANY(${scope.cabinetItemIds}::uuid[])` : Prisma.empty}
      ) s
      WHERE score >= ${MATCH_THRESHOLD}`;
    const data = rows
      .filter((r) => !r.brand?.trim() || brandAppears(r.brand, r.product_description))
      .map((r) => ({ recallId: r.recall_id, cabinetItemId: r.cabinet_item_id, groupId: r.group_id, score: r.score }));
    if (!data.length) return [];
    const created = await db.recallMatch.createManyAndReturn({ data, skipDuplicates: true, select: { groupId: true } });
    return [...new Set(created.map((m) => m.groupId))];
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
