// Attack 2: cascades and orphans. What disappears, what is blocked, and what is left behind.
import { describe, expect, it } from "vitest";
import { itemId, mkGroup, mkItem, mkUser, rolledBack, tryQuery } from "./helpers.js";
import type pg from "pg";

async function count(c: pg.Client, sql: string, params: unknown[] = []): Promise<number> {
  return (await c.query(`SELECT count(*)::int AS n FROM (${sql}) x`, params)).rows[0].n;
}

/** A household with list, cabinet, recall match and invite, so every cascade path has something to delete. */
async function household(c: pg.Client) {
  const owner = await mkUser(c, { name: "Owner" });
  const peanutKid = await mkUser(c, { name: "Peanut Kid", allergens: ["peanuts"] });
  await c.query(`INSERT INTO user_diets VALUES ($1, 'vegan')`, [peanutKid]);
  const g = await mkGroup(c, owner, peanutKid);
  const pb = await itemId(c, "Peanut Butter");
  const cheerios = await itemId(c, "Cheerios");
  await c.query(`INSERT INTO preferences (group_id, user_id, item_id) VALUES ($1, $2, $3), ($1, $4, $3)`, [g, owner, pb, peanutKid]);
  const cab = await c.query(
    `INSERT INTO cabinet_items (group_id, item_id, added_by) VALUES ($1, $2, $3) RETURNING id`,
    [g, cheerios, peanutKid],
  );
  const rec = await c.query(
    `INSERT INTO recalls (source, external_id, product_description) VALUES ('demo', $1, 'Cheerios break test') RETURNING id`,
    [`BREAK-${g}`],
  );
  await c.query(`INSERT INTO recall_matches (recall_id, group_id, cabinet_item_id, score) VALUES ($1, $2, $3, 0.9)`, [rec.rows[0].id, g, cab.rows[0].id]);
  await c.query(`INSERT INTO group_invites (group_id, email, invited_by) VALUES ($1, 'friend@example.test', $2)`, [g, peanutKid]);
  await c.query(`SELECT generate_shopping_list($1)`, [g]);
  return { owner, peanutKid, g, pb, cheerios, cabId: cab.rows[0].id as string, recallId: rec.rows[0].id as string };
}

describe("cascades that behave as the plan says", () => {
  it("deleting a user cascades memberships, preferences, allergens, diets; SET NULLs created_by / added_by / invited_by", () =>
    rolledBack(async (c) => {
      const h = await household(c);
      await c.query(`DELETE FROM users WHERE id = $1`, [h.peanutKid]);
      expect(await count(c, `SELECT 1 FROM group_members WHERE user_id = $1`, [h.peanutKid])).toBe(0);
      expect(await count(c, `SELECT 1 FROM preferences WHERE user_id = $1`, [h.peanutKid])).toBe(0);
      expect(await count(c, `SELECT 1 FROM user_allergens WHERE user_id = $1`, [h.peanutKid])).toBe(0);
      expect(await count(c, `SELECT 1 FROM user_diets WHERE user_id = $1`, [h.peanutKid])).toBe(0);
      expect(await count(c, `SELECT 1 FROM cabinet_items WHERE id = $1 AND added_by IS NULL`, [h.cabId])).toBe(1);
      expect(await count(c, `SELECT 1 FROM group_invites WHERE group_id = $1 AND invited_by IS NULL`, [h.g])).toBe(1);
    }));

  it("deleting the only owner hands ownership to the longest-standing member", () =>
    rolledBack(async (c) => {
      const h = await household(c);
      await c.query(`DELETE FROM users WHERE id = $1`, [h.owner]);
      const r = await c.query(`SELECT user_id, role FROM group_members WHERE group_id = $1`, [h.g]);
      expect(r.rows).toEqual([{ user_id: h.peanutKid, role: "owner" }]);
      expect(await count(c, `SELECT 1 FROM groups WHERE id = $1 AND created_by IS NULL`, [h.g])).toBe(1);
    }));

  it("deleting a group cascades members, invites, preferences, cabinet, list, recall matches (owner trigger doesn't break it)", () =>
    rolledBack(async (c) => {
      const h = await household(c);
      await c.query(`DELETE FROM groups WHERE id = $1`, [h.g]);
      for (const t of ["group_members", "group_invites", "preferences", "cabinet_items", "shopping_list_items", "recall_matches"]) {
        expect(await count(c, `SELECT 1 FROM ${t} WHERE group_id = $1`, [h.g]), t).toBe(0);
      }
      expect(await count(c, `SELECT 1 FROM recalls WHERE id = $1`, [h.recallId]), "global recall survives").toBe(1);
    }));

  it("ran out (deleting a cabinet row) cascades its recall matches", () =>
    rolledBack(async (c) => {
      const h = await household(c);
      await c.query(`DELETE FROM cabinet_items WHERE id = $1`, [h.cabId]);
      expect(await count(c, `SELECT 1 FROM recall_matches WHERE cabinet_item_id = $1`, [h.cabId])).toBe(0);
    }));

  it("a recall match can't point at another group's cabinet item", () =>
    rolledBack(async (c) => {
      const h = await household(c);
      const other = await mkGroup(c, await mkUser(c));
      const rec = await c.query(`INSERT INTO recalls (source, external_id, product_description) VALUES ('demo', $1, 'x') RETURNING id`, [`BREAK2-${other}`]);
      const err = await tryQuery(c, `INSERT INTO recall_matches (recall_id, group_id, cabinet_item_id, score) VALUES ($1, $2, $3, 0.5)`, [rec.rows[0].id, other, h.cabId]);
      expect(err?.code).toBe("23503");
    }));

  it("deleting a catalog item in use is blocked; an unused one takes its aliases and price cache with it", () =>
    rolledBack(async (c) => {
      const h = await household(c);
      expect((await tryQuery(c, `DELETE FROM items WHERE id = $1`, [h.pb]))?.code).toBe("23503");
      const x = await mkItem(c, "Break Unused Item");
      await c.query(`INSERT INTO item_aliases (item_id, alias_normalized) VALUES ($1, 'break unused alia')`, [x]);
      await c.query(`INSERT INTO price_estimates (item_id, zip_code, low_cents, high_cents) VALUES ($1, '64101', 1, 2)`, [x]);
      await c.query(`DELETE FROM items WHERE id = $1`, [x]);
      expect(await count(c, `SELECT 1 FROM item_aliases WHERE item_id = $1`, [x])).toBe(0);
      expect(await count(c, `SELECT 1 FROM price_estimates WHERE item_id = $1`, [x])).toBe(0);
    }));

  it("deleting a product un-links cabinet and list rows (SET NULL)", () =>
    rolledBack(async (c) => {
      const h = await household(c);
      const p = await c.query(`INSERT INTO products (item_id, gtin, name, source, fetched_at) VALUES ($1, '12345670', 'C', 'manual', now()) RETURNING id`, [h.cheerios]);
      await c.query(`UPDATE cabinet_items SET product_id = $1 WHERE id = $2`, [p.rows[0].id, h.cabId]);
      await c.query(`DELETE FROM products WHERE id = $1`, [p.rows[0].id]);
      expect(await count(c, `SELECT 1 FROM cabinet_items WHERE id = $1 AND product_id IS NULL`, [h.cabId])).toBe(1);
    }));
});

describe("defects: data left behind", () => {
  it("[DB-03] DELETE /me leaves no trace of the user in shopping_list_items (wanted_by, allergen_flags)", () =>
    rolledBack(async (c) => {
      const h = await household(c);
      // Before: Peanut Butter is wanted by both, and carries the Peanut Kid's peanut badge with their display name.
      const before = await c.query(`SELECT wanted_by, allergen_flags FROM shopping_list_items WHERE group_id = $1 AND item_id = $2`, [h.g, h.pb]);
      expect(before.rows[0].wanted_by).toContain(h.peanutKid);
      expect(JSON.stringify(before.rows[0].allergen_flags)).toContain("Peanut Kid");

      await c.query(`DELETE FROM users WHERE id = $1`, [h.peanutKid]); // plan 11 step 5: DELETE /me removes the user

      const left = await c.query(
        `SELECT s.id FROM shopping_list_items s
         WHERE $1 = ANY (s.wanted_by)
            OR s.allergen_flags @> jsonb_build_array(jsonb_build_object('userId', $1::text))`,
        [h.peanutKid],
      );
      expect(left.rowCount, "deleted user's id, display name and allergy are still stored on the list").toBe(0);
    }));

  it("[DB-03] leaving a group leaves the ex-member on that group's list rows", () =>
    rolledBack(async (c) => {
      const h = await household(c);
      await c.query(`DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`, [h.g, h.peanutKid]);
      const left = await c.query(
        `SELECT 1 FROM shopping_list_items s WHERE s.group_id = $1
           AND ($2 = ANY (s.wanted_by) OR s.allergen_flags @> jsonb_build_array(jsonb_build_object('userId', $2::text)))`,
        [h.g, h.peanutKid],
      );
      expect(left.rowCount).toBe(0);
    }));
});
