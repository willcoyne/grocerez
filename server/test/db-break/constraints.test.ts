// Attack 1: constraints. Every invalid state the plan forbids must be rejected by the database.
import { describe, expect, it } from "vitest";
import { itemId, mkGroup, mkUser, rolledBack, tryQuery } from "./helpers.js";

describe("constraints the plan requires (expected to hold)", () => {
  it("rejects a duplicate membership", () =>
    rolledBack(async (c) => {
      const a = await mkUser(c);
      const g = await mkGroup(c, a);
      const err = await tryQuery(c, `INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)`, [g, a]);
      expect(err?.code).toBe("23505");
    }));

  it("rejects a duplicate preference per (group, user, item)", () =>
    rolledBack(async (c) => {
      const a = await mkUser(c);
      const g = await mkGroup(c, a);
      const milk = await itemId(c, "Milk");
      await c.query(`INSERT INTO preferences (group_id, user_id, item_id) VALUES ($1, $2, $3)`, [g, a, milk]);
      const err = await tryQuery(c, `INSERT INTO preferences (group_id, user_id, item_id, quantity_text) VALUES ($1, $2, $3, '2 gal')`, [g, a, milk]);
      expect(err?.code).toBe("23505");
    }));

  it("rejects a preference for someone who is not a member of the group", () =>
    rolledBack(async (c) => {
      const a = await mkUser(c);
      const stranger = await mkUser(c);
      const g = await mkGroup(c, a);
      const err = await tryQuery(c, `INSERT INTO preferences (group_id, user_id, item_id) VALUES ($1, $2, $3)`, [g, stranger, await itemId(c, "Milk")]);
      expect(err?.code).toBe("23503");
    }));

  it("rejects a second cabinet row for the same item", () =>
    rolledBack(async (c) => {
      const a = await mkUser(c);
      const g = await mkGroup(c, a);
      const milk = await itemId(c, "Milk");
      await c.query(`INSERT INTO cabinet_items (group_id, item_id) VALUES ($1, $2)`, [g, milk]);
      const err = await tryQuery(c, `INSERT INTO cabinet_items (group_id, item_id, status) VALUES ($1, $2, 'running_low')`, [g, milk]);
      expect(err?.code).toBe("23505");
    }));

  it.each(["Bob@Example.com", " bob@example.com", "bob@example.com ", "BOB@EXAMPLE.COM", "", "   "])(
    "rejects invite email %j (must be lower-cased and trimmed)",
    (email) =>
      rolledBack(async (c) => {
        const a = await mkUser(c);
        const g = await mkGroup(c, a);
        const err = await tryQuery(c, `INSERT INTO group_invites (group_id, email, invited_by) VALUES ($1, $2, $3)`, [g, email, a]);
        expect(err?.code).toBe("23514");
      }),
  );

  it("keeps one invite row per (group, email)", () =>
    rolledBack(async (c) => {
      const a = await mkUser(c);
      const g = await mkGroup(c, a);
      await c.query(`INSERT INTO group_invites (group_id, email) VALUES ($1, 'x@example.com')`, [g]);
      const err = await tryQuery(c, `INSERT INTO group_invites (group_id, email) VALUES ($1, 'x@example.com')`, [g]);
      expect(err?.code).toBe("23505");
    }));

  it("rejects a non-manual product with neither GTIN nor SmartLabel URL", () =>
    rolledBack(async (c) => {
      const err = await tryQuery(
        c,
        `INSERT INTO products (item_id, name, source, fetched_at) VALUES ($1, 'x', 'openfoodfacts', now())`,
        [await itemId(c, "Milk")],
      );
      expect(err?.code).toBe("23514");
    }));

  it("rejects unknown allergens and diets", () =>
    rolledBack(async (c) => {
      const a = await mkUser(c);
      expect((await tryQuery(c, `INSERT INTO user_allergens VALUES ($1, 'mustard')`, [a]))?.code).toBe("22P02");
      expect((await tryQuery(c, `INSERT INTO user_diets VALUES ($1, 'paleo')`, [a]))?.code).toBe("23514");
      expect((await tryQuery(c, `INSERT INTO user_diets VALUES ($1, 'Vegan')`, [a]))?.code).toBe("23514");
      expect((await tryQuery(c, `UPDATE items SET default_allergens = '{lupin}' WHERE normalized_name = 'milk'`))?.code).toBe("22P02");
    }));

  it("rejects negative or null required values", () =>
    rolledBack(async (c) => {
      const milk = await itemId(c, "Milk");
      const cases: [string, unknown[]][] = [
        [`UPDATE items SET shelf_life_days = 0 WHERE id = $1`, [milk]],
        [`UPDATE items SET shelf_life_days = -5 WHERE id = $1`, [milk]],
        [`INSERT INTO price_estimates (item_id, zip_code, low_cents, high_cents) VALUES ($1, '64101', -1, 10)`, [milk]],
        [`INSERT INTO price_estimates (item_id, zip_code, low_cents, high_cents) VALUES ($1, '64101', 10, 5)`, [milk]],
        [`INSERT INTO price_estimates (item_id, zip_code, low_cents, high_cents, typical_cents) VALUES ($1, '64101', 1, 5, 9)`, [milk]],
        [`INSERT INTO price_estimates (item_id, zip_code, low_cents, high_cents) VALUES ($1, '6410', 1, 5)`, [milk]],
        [`INSERT INTO products (item_id, gtin, name, source, fetched_at, calories_per_serving) VALUES ($1, '12345678', 'x', 'manual', now(), -1)`, [milk]],
        [`INSERT INTO products (item_id, gtin, name, source, fetched_at) VALUES ($1, '1234-5678', 'x', 'manual', now())`, [milk]],
        [`INSERT INTO users (google_sub, email, display_name) VALUES ('s', 'a@b.c', NULL)`, []],
        [`INSERT INTO groups (name) VALUES ('   ')`, []],
        [`INSERT INTO items (name, normalized_name) VALUES ('Milk Two', 'milk 2')`, []],
        [`INSERT INTO items (name, normalized_name) VALUES ('!!!', '')`, []],
        [`INSERT INTO item_aliases (item_id, alias_normalized) VALUES ($1, 'Cherrios')`, [milk]],
      ];
      for (const [sql, params] of cases) {
        const err = await tryQuery(c, sql, params);
        expect(err, sql).not.toBeNull();
      }
    }));

  it("keeps checked / checked_by / checked_at consistent (trigger + CHECKs)", () =>
    rolledBack(async (c) => {
      const a = await mkUser(c);
      const g = await mkGroup(c, a);
      const r = await c.query(
        `INSERT INTO shopping_list_items (group_id, item_id, reason) VALUES ($1, $2, 'manual') RETURNING id`,
        [g, await itemId(c, "Milk")],
      );
      const id = r.rows[0].id;
      await c.query(`UPDATE shopping_list_items SET checked = true, checked_by = $2 WHERE id = $1`, [id, a]);
      let row = (await c.query(`SELECT checked_by, checked_at FROM shopping_list_items WHERE id = $1`, [id])).rows[0];
      expect(row.checked_by).toBe(a);
      expect(row.checked_at).not.toBeNull();
      await c.query(`UPDATE shopping_list_items SET checked = false WHERE id = $1`, [id]);
      row = (await c.query(`SELECT checked_by, checked_at FROM shopping_list_items WHERE id = $1`, [id])).rows[0];
      expect(row).toEqual({ checked_by: null, checked_at: null });
    }));
});

describe("defects: invalid states the database accepts", () => {
  it("[DB-04] rejects linking a cabinet row to a product of a DIFFERENT catalog item (it suppresses allergen badges)", () =>
    rolledBack(async (c) => {
      // User with a milk allergy; Milk is running low, so it is on the list and must carry a milk badge.
      const a = await mkUser(c, { allergens: ["milk"] });
      const g = await mkGroup(c, a);
      const milk = await itemId(c, "Milk");
      const oreos = await itemId(c, "Oreos");
      await c.query(`INSERT INTO preferences (group_id, user_id, item_id) VALUES ($1, $2, $3)`, [g, a, milk]);
      // An Oreos product (no milk listed) gets attached to the MILK cabinet row (a wrong scan / buggy finish-trip).
      const p = await c.query(
        `INSERT INTO products (item_id, gtin, name, source, fetched_at, allergens) VALUES ($1, '99999999', 'Oreo Thins', 'openfoodfacts', now(), '{wheat,soy}') RETURNING id`,
        [oreos],
      );
      const err = await tryQuery(
        c,
        `INSERT INTO cabinet_items (group_id, item_id, product_id, status) VALUES ($1, $2, $3, 'running_low')`,
        [g, milk, p.rows[0].id],
      );
      if (err === null) {
        // The database accepted it. Show the consequence: the milk badge disappears from Milk on the list.
        await c.query(`SELECT generate_shopping_list($1)`, [g]);
        const flags = await c.query(
          `SELECT allergen_flags FROM shopping_list_items WHERE group_id = $1 AND item_id = $2`,
          [g, milk],
        );
        expect(flags.rows[0].allergen_flags, "Milk lost its milk badge for a milk-allergic member").toEqual([
          expect.objectContaining({ userId: a, allergen: "milk" }),
        ]);
      }
      expect(err, "cabinet_items.product_id must belong to the same item_id").not.toBeNull();
    }));

  it("[DB-04] rejects a scanned_product_id that belongs to a different catalog item", () =>
    rolledBack(async (c) => {
      const a = await mkUser(c);
      const g = await mkGroup(c, a);
      const p = await c.query(
        `INSERT INTO products (item_id, gtin, name, source, fetched_at) VALUES ($1, '99999998', 'Oreo', 'openfoodfacts', now()) RETURNING id`,
        [await itemId(c, "Oreos")],
      );
      const err = await tryQuery(
        c,
        `INSERT INTO shopping_list_items (group_id, item_id, reason, scanned_product_id) VALUES ($1, $2, 'manual', $3)`,
        [g, await itemId(c, "Peanut Butter"), p.rows[0].id],
      );
      expect(err).not.toBeNull();
    }));

  it("[DB-07] one physical barcode is one product row (UPC-A vs EAN-13 vs GTIN-14 of the same code)", () =>
    rolledBack(async (c) => {
      const cheerios = await itemId(c, "Cheerios");
      // 016000275287 is the UPC-A from the seeded demo recall; scanners report it as 12, 13 or 14 digits.
      await c.query(
        `INSERT INTO products (item_id, gtin, name, source, fetched_at) VALUES ($1, '016000275287', 'Cheerios 18 oz', 'openfoodfacts', now())`,
        [cheerios],
      );
      const e13 = await tryQuery(
        c,
        `INSERT INTO products (item_id, gtin, name, source, fetched_at) VALUES ($1, '0016000275287', 'Cheerios 18 oz', 'openfoodfacts', now())`,
        [cheerios],
      );
      const e14 = await tryQuery(
        c,
        `INSERT INTO products (item_id, gtin, name, source, fetched_at) VALUES ($1, '00016000275287', 'Cheerios 18 oz', 'openfoodfacts', now())`,
        [cheerios],
      );
      const n = await c.query(`SELECT count(*)::int AS n FROM products WHERE ltrim(gtin, '0') = '16000275287'`);
      expect({ ean13Rejected: e13 !== null, gtin14Rejected: e14 !== null, rows: n.rows[0].n }).toEqual({
        ean13Rejected: true,
        gtin14Rejected: true,
        rows: 1,
      });
    }));

  it("[DB-07] rejects a GTIN with a wrong check digit", () =>
    rolledBack(async (c) => {
      const err = await tryQuery(
        c,
        `INSERT INTO products (item_id, gtin, name, source, fetched_at) VALUES ($1, '016000275288', 'bad check digit', 'openfoodfacts', now())`,
        [await itemId(c, "Cheerios")],
      );
      expect(err).not.toBeNull();
    }));

  it("[DB-12] rejects a product whose only identifier is an empty SmartLabel URL", () =>
    rolledBack(async (c) => {
      const err = await tryQuery(
        c,
        `INSERT INTO products (item_id, smartlabel_url, name, source, fetched_at) VALUES ($1, '', 'x', 'smartlabel', now())`,
        [await itemId(c, "Milk")],
      );
      expect(err).not.toBeNull();
    }));

  it("[DB-12] rejects NaN / Infinity calories", () =>
    rolledBack(async (c) => {
      const milk = await itemId(c, "Milk");
      const nan = await tryQuery(c, `INSERT INTO products (item_id, gtin, name, source, fetched_at, calories_per_serving) VALUES ($1, '11111111', 'x', 'manual', now(), 'NaN')`, [milk]);
      const inf = await tryQuery(c, `INSERT INTO products (item_id, gtin, name, source, fetched_at, calories_per_serving) VALUES ($1, '22222222', 'x', 'manual', now(), 'Infinity')`, [milk]);
      expect({ nanRejected: nan !== null, infRejected: inf !== null }).toEqual({ nanRejected: true, infRejected: true });
    }));

  it("[DB-13] rejects a blank user email or display name", () =>
    rolledBack(async (c) => {
      const blankEmail = await tryQuery(c, `INSERT INTO users (google_sub, email, display_name) VALUES ('break-blank-1', '', 'X')`);
      const blankName = await tryQuery(c, `INSERT INTO users (google_sub, email, display_name) VALUES ('break-blank-2', 'b2@example.test', '  ')`);
      expect({ blankEmailRejected: blankEmail !== null, blankNameRejected: blankName !== null }).toEqual({
        blankEmailRejected: true,
        blankNameRejected: true,
      });
    }));

  it("[DB-13] users.zip_code follows the same 5-digit rule as price_estimates.zip_code", () =>
    rolledBack(async (c) => {
      const err = await tryQuery(c, `INSERT INTO users (google_sub, email, display_name, zip_code) VALUES ('break-zip', 'zip@example.test', 'Z', 'KC MO')`);
      expect(err, "a zip the price cache can never use is accepted on the profile").not.toBeNull();
    }));

  it("[DB-09] a group always keeps an owner (demoting the only owner is rejected or hands off)", () =>
    rolledBack(async (c) => {
      const a = await mkUser(c);
      const b = await mkUser(c);
      const g = await mkGroup(c, a, b);
      await tryQuery(c, `UPDATE group_members SET role = 'member' WHERE group_id = $1 AND user_id = $2`, [g, a]);
      const owners = await c.query(`SELECT count(*)::int AS n FROM group_members WHERE group_id = $1 AND role = 'owner'`, [g]);
      expect(owners.rows[0].n).toBe(1);
    }));

});
