// Attack 5: set logic on the seeded demo (plan database/10, backend/06). Union and difference by hand vs generate_shopping_list().
import { describe, expect, it } from "vitest";
import type pg from "pg";
import { DEMO_GROUP_ID, SEED_USERS, itemId, listNames, mkGroup, mkUser, rolledBack } from "./helpers.js";

const G = DEMO_GROUP_ID;

/** (∪ preferences) − (in-stock cabinet), computed by hand without any of the builder's SQL functions. */
async function byHand(c: pg.Client, g: string): Promise<string[]> {
  const r = await c.query(
    `SELECT DISTINCT i.name FROM preferences p JOIN items i ON i.id = p.item_id WHERE p.group_id = $1
     EXCEPT
     SELECT i.name FROM cabinet_items c JOIN items i ON i.id = c.item_id WHERE c.group_id = $1 AND c.status = 'in_stock'
     ORDER BY 1`,
    [g],
  );
  return r.rows.map((x) => x.name);
}

describe("demo set logic (expected to hold)", () => {
  it("union of the 4 users is {Cheerios, Tostitos, Lay's, Oreos} plus the staples", () =>
    rolledBack(async (c) => {
      const r = await c.query(
        `SELECT i.name, array_length(array_agg(p.user_id), 1) AS n FROM preferences p JOIN items i ON i.id = p.item_id
         WHERE p.group_id = $1 GROUP BY i.name ORDER BY i.name`,
        [G],
      );
      expect(r.rows).toEqual([
        { name: "Bread", n: 1 },
        { name: "Cheerios", n: 2 },
        { name: "Lay's", n: 2 },
        { name: "Milk", n: 1 },
        { name: "Oreos", n: 2 },
        { name: "Peanut Butter", n: 1 },
        { name: "Tostitos", n: 1 },
      ]);
    }));

  it("the generated list equals the hand-computed difference: Tostitos, Lay's, Oreos + Milk, Peanut Butter, Bread", () =>
    rolledBack(async (c) => {
      expect((await c.query(`SELECT generate_shopping_list($1) AS n`, [G])).rows[0].n).toBe(0);
      const list = await listNames(c, G);
      expect(list).toEqual(await byHand(c, G));
      expect(list).toEqual(["Bread", "Lay's", "Milk", "Oreos", "Peanut Butter", "Tostitos"]);
    }));

  it("allergen badges: Milk → User 3 (milk), Peanut Butter → User 4 (peanuts), nothing else", () =>
    rolledBack(async (c) => {
      const r = await c.query(
        `SELECT i.name, f->>'userId' AS u, f->>'allergen' AS a FROM shopping_list_items s JOIN items i ON i.id = s.item_id,
                jsonb_array_elements(s.allergen_flags) f WHERE s.group_id = $1 ORDER BY 1, 2, 3`,
        [G],
      );
      expect(r.rows).toEqual([
        { name: "Milk", u: SEED_USERS[2], a: "milk" },
        { name: "Peanut Butter", u: SEED_USERS[3], a: "peanuts" },
      ]);
    }));

  it("running generation twice changes nothing", () =>
    rolledBack(async (c) => {
      await c.query(`SELECT generate_shopping_list($1)`, [G]);
      const before = (await c.query(`SELECT id, updated_at FROM shopping_list_items WHERE group_id = $1 ORDER BY id`, [G])).rows;
      expect((await c.query(`SELECT generate_shopping_list($1) AS n`, [G])).rows[0].n).toBe(0);
      expect((await c.query(`SELECT id, updated_at FROM shopping_list_items WHERE group_id = $1 ORDER BY id`, [G])).rows).toEqual(before);
    }));

  it("Cheerios running low → back on the list; ran out (row deleted) → also on the list", () =>
    rolledBack(async (c) => {
      const cheerios = await itemId(c, "Cheerios");
      await c.query(`UPDATE cabinet_items SET status = 'running_low' WHERE group_id = $1 AND item_id = $2`, [G, cheerios]);
      await c.query(`SELECT generate_shopping_list($1)`, [G]);
      expect(await listNames(c, G)).toContain("Cheerios");
      await c.query(`UPDATE cabinet_items SET status = 'in_stock' WHERE group_id = $1 AND item_id = $2`, [G, cheerios]);
      await c.query(`SELECT generate_shopping_list($1)`, [G]);
      expect(await listNames(c, G)).not.toContain("Cheerios");
      await c.query(`DELETE FROM cabinet_items WHERE group_id = $1 AND item_id = $2`, [G, cheerios]);
      await c.query(`SELECT generate_shopping_list($1)`, [G]);
      expect(await listNames(c, G)).toEqual(await byHand(c, G));
      expect(await listNames(c, G)).toContain("Cheerios");
    }));

  it("Oreos restocked (running_low → in_stock) drops off; a checked row survives regeneration", () =>
    rolledBack(async (c) => {
      const oreos = await itemId(c, "Oreos");
      const lays = await itemId(c, "Lay's");
      await c.query(`UPDATE shopping_list_items SET checked = true, checked_by = $3 WHERE group_id = $1 AND item_id = $2`, [G, lays, SEED_USERS[0]]);
      await c.query(`UPDATE cabinet_items SET status = 'in_stock' WHERE group_id = $1 AND item_id = $2`, [G, oreos]);
      await c.query(`INSERT INTO cabinet_items (group_id, item_id) VALUES ($1, $2)`, [G, lays]); // bought, but still checked on the list
      await c.query(`SELECT generate_shopping_list($1)`, [G]);
      const list = await listNames(c, G);
      expect(list).not.toContain("Oreos");
      expect(list).toContain("Lay's");
    }));

  it("a member with zero preferences changes nothing except allergen badges", () =>
    rolledBack(async (c) => {
      const before = await listNames(c, G);
      const lurker = await mkUser(c, { name: "Lurker", allergens: ["wheat"] });
      await c.query(`INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)`, [G, lurker]);
      await c.query(`SELECT generate_shopping_list($1)`, [G]);
      expect(await listNames(c, G)).toEqual(before);
      const bread = await c.query(
        `SELECT s.allergen_flags FROM shopping_list_items s WHERE s.group_id = $1 AND s.item_id = $2`,
        [G, await itemId(c, "Bread")],
      );
      expect(bread.rows[0].allergen_flags).toEqual([expect.objectContaining({ userId: lurker, allergen: "wheat" })]);
    }));

  it("a group with zero members has an empty list and generation is a no-op", () =>
    rolledBack(async (c) => {
      const u = await mkUser(c);
      const g = await mkGroup(c, u);
      await c.query(`DELETE FROM group_members WHERE group_id = $1`, [g]);
      expect((await c.query(`SELECT generate_shopping_list($1) AS n`, [g])).rows[0].n).toBe(0);
      expect(await listNames(c, g)).toEqual([]);
    }));

  it("removing the last preference for an item drops its unchecked row; a manual row stays", () =>
    rolledBack(async (c) => {
      const tostitos = await itemId(c, "Tostitos");
      const salt = await itemId(c, "Salt");
      await c.query(`INSERT INTO shopping_list_items (group_id, item_id, reason, added_by) VALUES ($1, $2, 'manual', $3)`, [G, salt, SEED_USERS[0]]);
      await c.query(`DELETE FROM preferences WHERE group_id = $1 AND item_id = $2`, [G, tostitos]);
      await c.query(`SELECT generate_shopping_list($1)`, [G]);
      const list = await listNames(c, G);
      expect(list).not.toContain("Tostitos");
      expect(list).toContain("Salt");
    }));

  it("generation only reads its own group (another group's cabinet doesn't subtract)", () =>
    rolledBack(async (c) => {
      const u = await mkUser(c);
      const other = await mkGroup(c, u);
      await c.query(`INSERT INTO cabinet_items (group_id, item_id) VALUES ($1, $2)`, [other, await itemId(c, "Tostitos")]);
      await c.query(`SELECT generate_shopping_list($1)`, [G]);
      expect(await listNames(c, G)).toContain("Tostitos");
    }));
});
