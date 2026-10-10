// Attack 6: concurrency. Real committed transactions on separate connections.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { connect, itemId, mkGroup, mkUser, sleep } from "./helpers.js";

let admin: pg.Client;
const users: string[] = [];
const groups: string[] = [];
const open: pg.Client[] = [];

beforeAll(async () => {
  admin = await connect();
});
afterEach(async () => {
  for (const c of open.splice(0)) await c.end().catch(() => {});
});
afterAll(async () => {
  if (groups.length) await admin.query(`DELETE FROM groups WHERE id = ANY ($1::uuid[])`, [groups]);
  if (users.length) await admin.query(`DELETE FROM users WHERE id = ANY ($1::uuid[])`, [users]);
  await admin.end();
});

async function tx(): Promise<pg.Client> {
  const c = await connect();
  open.push(c);
  pids.set(c, (await c.query(`SELECT pg_backend_pid() AS p`)).rows[0].p);
  await c.query("BEGIN");
  return c;
}

/** Committed fixture: users (first is owner), joined in order. */
async function committedGroup(n: number, roles: ("owner" | "member")[] = []) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await mkUser(admin, { name: `Conc ${i}` }));
  users.push(...ids);
  const g = await mkGroup(admin, ids[0], ...ids.slice(1));
  groups.push(g);
  for (const [i, r] of roles.entries()) {
    await admin.query(`UPDATE group_members SET role = $3::group_role WHERE group_id = $1 AND user_id = $2`, [g, ids[i], r]);
  }
  return { g, ids };
}

/** Waits until the backend with this pid is blocked on a lock. */
async function waitBlocked(pid: number) {
  for (let i = 0; i < 200; i++) {
    const r = await admin.query(`SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`, [pid]);
    if (r.rows[0]?.wait_event_type === "Lock") return;
    await sleep(10);
  }
  throw new Error(`pid ${pid} never blocked`);
}

// pids are read when the transaction opens: a client with a pending (blocked) query queues anything sent after it.
const pids = new WeakMap<pg.Client, number>();
const pidOf = async (c: pg.Client): Promise<number> => pids.get(c)!;

async function owners(g: string): Promise<number> {
  return (await admin.query(`SELECT count(*)::int AS n FROM group_members WHERE group_id = $1 AND role = 'owner'`, [g])).rows[0].n;
}
async function members(g: string): Promise<number> {
  return (await admin.query(`SELECT count(*)::int AS n FROM group_members WHERE group_id = $1`, [g])).rows[0].n;
}

describe("concurrency the database handles (expected to hold)", () => {
  it("two concurrent upserts of the same preference leave one row with the last value", async () => {
    const { g, ids } = await committedGroup(1);
    const milk = await itemId(admin, "Milk");
    const sql = `INSERT INTO preferences (group_id, user_id, item_id, quantity_text) VALUES ($1, $2, $3, $4)
                 ON CONFLICT (group_id, user_id, item_id) DO UPDATE SET quantity_text = EXCLUDED.quantity_text`;
    const [t1, t2] = [await tx(), await tx()];
    await t1.query(sql, [g, ids[0], milk, "1 gal"]);
    const p2 = t2.query(sql, [g, ids[0], milk, "2 gal"]);
    await waitBlocked(await pidOf(t2));
    await t1.query("COMMIT");
    await p2;
    await t2.query("COMMIT");
    const r = await admin.query(`SELECT quantity_text FROM preferences WHERE group_id = $1`, [g]);
    expect(r.rows).toEqual([{ quantity_text: "2 gal" }]);
  });

  it("two concurrent cabinet upserts leave one row", async () => {
    const { g } = await committedGroup(1);
    const eggs = await itemId(admin, "Eggs");
    const sql = `INSERT INTO cabinet_items (group_id, item_id, quantity_text) VALUES ($1, $2, $3)
                 ON CONFLICT (group_id, item_id) DO UPDATE SET quantity_text = EXCLUDED.quantity_text, status = 'in_stock'`;
    const [t1, t2] = [await tx(), await tx()];
    await t1.query(sql, [g, eggs, "12"]);
    const p2 = t2.query(sql, [g, eggs, "18"]);
    await waitBlocked(await pidOf(t2));
    await t1.query("COMMIT");
    await p2;
    await t2.query("COMMIT");
    expect((await admin.query(`SELECT count(*)::int AS n FROM cabinet_items WHERE group_id = $1`, [g])).rows[0].n).toBe(1);
  });

  it("accepting the same invite twice at once yields one membership and one accepted invite", async () => {
    const { g } = await committedGroup(1);
    const joiner = await mkUser(admin, { name: "Joiner" });
    users.push(joiner);
    const email = (await admin.query(`SELECT email FROM users WHERE id = $1`, [joiner])).rows[0].email;
    const inv = await admin.query(`INSERT INTO group_invites (group_id, email) VALUES ($1, $2) RETURNING id`, [g, email]);
    // backend/03 step 9 accept, as two requests (double tap).
    const accept = async (c: pg.Client) => {
      const u = await c.query(
        `UPDATE group_invites SET status = 'accepted', responded_at = now() WHERE id = $1 AND status = 'pending' AND email = $2`,
        [inv.rows[0].id, email],
      );
      if (u.rowCount === 1) {
        await c.query(`INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [g, joiner]);
      }
      return u.rowCount;
    };
    const [t1, t2] = [await tx(), await tx()];
    const a1 = await accept(t1);
    const p2 = accept(t2);
    await waitBlocked(await pidOf(t2));
    await t1.query("COMMIT");
    const a2 = await p2;
    await t2.query("COMMIT");
    expect([a1, a2]).toEqual([1, 0]);
    expect(await members(g)).toBe(2);
  });

  it("two concurrent generate_shopping_list() calls don't duplicate rows", async () => {
    const { g, ids } = await committedGroup(1);
    await admin.query(`INSERT INTO preferences (group_id, user_id, item_id) VALUES ($1, $2, $3), ($1, $2, $4)`, [
      g, ids[0], await itemId(admin, "Milk"), await itemId(admin, "Bread"),
    ]);
    const [t1, t2] = [await tx(), await tx()];
    await t1.query(`SELECT generate_shopping_list($1)`, [g]);
    const p2 = t2.query(`SELECT generate_shopping_list($1) AS n`, [g]);
    await waitBlocked(await pidOf(t2));
    await t1.query("COMMIT");
    expect((await p2).rows[0].n).toBe(0);
    await t2.query("COMMIT");
    expect((await admin.query(`SELECT count(*)::int AS n FROM shopping_list_items WHERE group_id = $1`, [g])).rows[0].n).toBe(2);
  });
});

describe("defects", () => {
  // plan database/11 step 5: "If they were a group's only owner, ownership passes to the longest-standing member."
  it("[DB-01] owner leaves while the next-in-line member leaves → the remaining member must become owner", async () => {
    const { g, ids } = await committedGroup(3); // A owner, B (next in line), C
    const [tB, tA] = [await tx(), await tx()];
    await tB.query(`DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`, [g, ids[1]]); // B leaves
    const pA = tA.query(`DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`, [g, ids[0]]); // A leaves; trigger promotes B → waits
    await waitBlocked(await pidOf(tA));
    await tB.query("COMMIT");
    await pA;
    await tA.query("COMMIT");
    expect(await members(g)).toBe(1);
    expect(await owners(g), "C is the only member left and nobody owns the group").toBe(1);
  });

  it("[DB-01] the two owners of a group leave at the same time → the remaining member must become owner", async () => {
    const { g } = await committedGroup(3, ["owner", "owner", "member"]);
    const ids = (await admin.query(`SELECT user_id FROM group_members WHERE group_id = $1 ORDER BY joined_at`, [g])).rows.map((r) => r.user_id);
    const [t1, t2] = [await tx(), await tx()];
    await t1.query(`DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`, [g, ids[0]]); // sees the other owner → no handoff
    await t2.query(`DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`, [g, ids[1]]); // sees the other owner → no handoff
    await t1.query("COMMIT");
    await t2.query("COMMIT");
    expect(await members(g)).toBe(1);
    expect(await owners(g)).toBe(1);
  });

  // backend/06 step 6 "Finish trip", in one transaction: upsert cabinet → delete checked rows → generate(groupId).
  // Meanwhile any other request (e.g. a member adds a preference) calls generate(groupId) in its own transaction.
  it("[DB-02] finish-trip and a concurrent generate_shopping_list() don't deadlock", async () => {
    const { g, ids } = await committedGroup(1);
    const milk = await itemId(admin, "Milk");
    const bread = await itemId(admin, "Bread");
    await admin.query(`INSERT INTO preferences (group_id, user_id, item_id) VALUES ($1, $2, $3), ($1, $2, $4)`, [g, ids[0], milk, bread]);
    await admin.query(`SELECT generate_shopping_list($1)`, [g]);
    await admin.query(`UPDATE shopping_list_items SET checked = true, checked_by = $2 WHERE group_id = $1 AND item_id = $3`, [g, ids[0], milk]);

    const [trip, other] = [await tx(), await tx()];
    // Finish trip, steps 2 and 4.
    await trip.query(`INSERT INTO cabinet_items (group_id, item_id, purchased_at) VALUES ($1, $2, now())
                      ON CONFLICT (group_id, item_id) DO UPDATE SET status = 'in_stock'`, [g, milk]);
    await trip.query(`DELETE FROM shopping_list_items WHERE group_id = $1 AND checked`, [g]);
    // Another request regenerates now: takes the advisory lock, then waits on the Milk row the trip deleted.
    const pOther = other.query(`SELECT generate_shopping_list($1)`, [g]).then(
      () => null,
      (e: Error & { code?: string }) => e,
    );
    await waitBlocked(await pidOf(other));
    // Finish trip, step 5: regenerate → waits for the advisory lock held by `other` → deadlock.
    const tripErr = await trip.query(`SELECT generate_shopping_list($1)`, [g]).then(
      () => null,
      (e: Error & { code?: string }) => e,
    );
    const otherErr = await pOther;
    await trip.query(tripErr ? "ROLLBACK" : "COMMIT");
    await other.query(otherErr ? "ROLLBACK" : "COMMIT");
    expect({ trip: tripErr?.code ?? "ok", other: otherErr?.code ?? "ok" }).toEqual({ trip: "ok", other: "ok" });
  });
});
