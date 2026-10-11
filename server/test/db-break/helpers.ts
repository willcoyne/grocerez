// Shared helpers for the database break tests (plan/database). Plain `pg`, no Prisma, so the tests talk to
// Postgres exactly the way a hostile or buggy caller could.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import pg from "pg";

export const DATABASE_URL = process.env["DATABASE_URL"] ?? "";

/** Refuse to run against anything that isn't a local database. */
export function assertLocal(url = DATABASE_URL): void {
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`db-break tests only run against a local DATABASE_URL (got host ${host})`);
  }
}

export function urlFor(opts: { database?: string; user?: string; password?: string }): string {
  const u = new URL(DATABASE_URL);
  if (opts.database) u.pathname = `/${opts.database}`;
  if (opts.user) u.username = opts.user;
  if (opts.password) u.password = opts.password;
  return u.toString();
}

export async function connect(url = DATABASE_URL): Promise<pg.Client> {
  assertLocal(url);
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  return c;
}

/** Runs fn inside BEGIN … ROLLBACK, so nothing a test does is kept. */
export async function rolledBack<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = await connect();
  try {
    await c.query("BEGIN");
    return await fn(c);
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
}

/** Runs one statement inside a savepoint. Returns the Postgres error, or null if it succeeded. */
export async function tryQuery(c: pg.Client, sql: string, params: unknown[] = []): Promise<(Error & { code?: string }) | null> {
  await c.query("SAVEPOINT t");
  try {
    await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT t");
    return null;
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT t");
    return e as Error & { code?: string };
  }
}

export const uid = (): string => randomUUID();

export async function mkUser(c: pg.Client, opts: { name?: string; allergens?: string[] } = {}): Promise<string> {
  const id = uid();
  await c.query(
    `INSERT INTO users (id, google_sub, email, display_name) VALUES ($1, $2, $3, $4)`,
    [id, `break-${id}`, `break-${id}@example.test`, opts.name ?? `Break ${id.slice(0, 8)}`],
  );
  for (const a of opts.allergens ?? []) {
    await c.query(`INSERT INTO user_allergens (user_id, allergen) VALUES ($1, $2::allergen)`, [id, a]);
  }
  return id;
}

/** Creates a group; the first user is the owner, the rest are members (joined 1 s apart, in order). */
export async function mkGroup(c: pg.Client, ownerId: string, ...memberIds: string[]): Promise<string> {
  const gid = uid();
  await c.query(`INSERT INTO groups (id, name, created_by) VALUES ($1, 'Break group', $2)`, [gid, ownerId]);
  const all = [ownerId, ...memberIds];
  for (const [i, u] of all.entries()) {
    await c.query(
      `INSERT INTO group_members (group_id, user_id, role, joined_at)
       VALUES ($1, $2, $3::group_role, timestamptz '2026-01-01 00:00Z' + make_interval(secs => $4))`,
      [gid, u, i === 0 ? "owner" : "member", i],
    );
  }
  return gid;
}

export async function itemId(c: pg.Client, name: string): Promise<string> {
  const r = await c.query(`SELECT id FROM items WHERE normalized_name = normalize_item_name($1)`, [name]);
  if (r.rowCount !== 1) throw new Error(`catalog item not found: ${name}`);
  return r.rows[0].id;
}

export async function mkItem(c: pg.Client, name: string, allergens: string[] = []): Promise<string> {
  const r = await c.query(
    `INSERT INTO items (name, normalized_name, category, default_allergens)
     VALUES ($1, normalize_item_name($1), 'other', $2::allergen[]) RETURNING id`,
    [name, allergens],
  );
  return r.rows[0].id;
}

export async function listNames(c: pg.Client, groupId: string): Promise<string[]> {
  const r = await c.query(
    `SELECT i.name FROM shopping_list_items s JOIN items i ON i.id = s.item_id WHERE s.group_id = $1 ORDER BY i.name`,
    [groupId],
  );
  return r.rows.map((x) => x.name);
}

export const DEMO_GROUP_ID = "00000000-0000-4000-8000-000000000001";
export const SEED_USERS = [
  "00000000-0000-4000-8000-000000000101",
  "00000000-0000-4000-8000-000000000102",
  "00000000-0000-4000-8000-000000000103",
  "00000000-0000-4000-8000-000000000104",
];

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
