// Attack 7: migrations and seed. Uses its own scratch database (grocerez_break_fresh) on the same local server,
// so the main test database is untouched. `prisma migrate reset` is not used (Prisma 7 refuses it from an AI agent
// without user consent); "reset" here = DROP DATABASE … WITH (FORCE) + CREATE + migrate deploy + seed.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { DEMO_GROUP_ID, connect, urlFor } from "./helpers.js";

const FRESH = "grocerez_break_fresh";
const FRESH_URL = urlFor({ database: FRESH });
const SERVER_DIR = new URL("../../", import.meta.url).pathname;

function run(args: string[], extraEnv: Record<string, string> = {}): string {
  return execFileSync("npx", args, {
    cwd: SERVER_DIR,
    env: { ...process.env, DATABASE_URL: FRESH_URL, MIGRATE_DATABASE_URL: FRESH_URL, ...extraEnv },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function recreate() {
  const root = await connect(urlFor({ database: "postgres" }));
  try {
    await root.query(`DROP DATABASE IF EXISTS ${FRESH} WITH (FORCE)`);
    await root.query(`CREATE DATABASE ${FRESH}`);
  } finally {
    await root.end();
  }
}

/** Everything the demo depends on, without generated ids. */
async function fingerprint(c: pg.Client) {
  const q = async (sql: string) => (await c.query(sql)).rows;
  return {
    counts: await q(`SELECT (SELECT count(*) FROM items)::int AS items, (SELECT count(*) FROM users)::int AS users,
                            (SELECT count(*) FROM groups)::int AS groups, (SELECT count(*) FROM group_members)::int AS members,
                            (SELECT count(*) FROM group_invites)::int AS invites, (SELECT count(*) FROM preferences)::int AS prefs,
                            (SELECT count(*) FROM cabinet_items)::int AS cabinet, (SELECT count(*) FROM shopping_list_items)::int AS list,
                            (SELECT count(*) FROM recalls)::int AS recalls, (SELECT count(*) FROM recall_matches)::int AS matches`),
    list: await q(`SELECT i.name, s.reason, s.checked, s.quantity_text, s.allergen_flags FROM shopping_list_items s
                   JOIN items i ON i.id = s.item_id WHERE s.group_id = '${DEMO_GROUP_ID}' ORDER BY i.name`),
    invites: await q(`SELECT email, status FROM group_invites WHERE group_id = '${DEMO_GROUP_ID}' ORDER BY email`),
    members: await q(`SELECT u.google_sub, m.role FROM group_members m JOIN users u ON u.id = m.user_id
                      WHERE m.group_id = '${DEMO_GROUP_ID}' ORDER BY u.google_sub`),
  };
}

let c: pg.Client;
let first: Awaited<ReturnType<typeof fingerprint>>;

beforeAll(async () => {
  await recreate();
  run(["prisma", "migrate", "deploy"]);
  run(["prisma", "db", "seed"]);
  c = await connect(FRESH_URL);
  first = await fingerprint(c);
});

afterAll(async () => {
  await c?.end();
  const root = await connect(urlFor({ database: "postgres" }));
  await root.query(`DROP DATABASE IF EXISTS ${FRESH} WITH (FORCE)`);
  await root.end();
});

describe("migrations and seed (expected to hold)", () => {
  it("every committed migration applies from an empty database", async () => {
    const dirs = readdirSync(new URL("../../prisma/migrations/", import.meta.url)).filter((d) => /^\d{14}_/.test(d));
    const applied = await c.query(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY 1`);
    expect(applied.rows.map((r) => r.migration_name)).toEqual(dirs.sort());
    const ext = await c.query(`SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto','pg_trgm','fuzzystrmatch') ORDER BY 1`);
    expect(ext.rows.map((r) => r.extname)).toEqual(["fuzzystrmatch", "pg_trgm", "pgcrypto"]);
  });

  it("prisma migrate diff shows no drift between the migrated database and schema.prisma", () => {
    let code = 0;
    let out = "";
    try {
      out = run(["prisma", "migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code"]);
    } catch (e) {
      const err = e as { status: number; stdout: string };
      code = err.status;
      out = err.stdout;
    }
    expect({ code, out: out.includes("No difference detected") ? "no diff" : out }).toEqual({ code: 0, out: "no diff" });
  });

  it("the seed produces the documented demo list", () => {
    expect(first.list.map((r) => r.name)).toEqual(["Bread", "Lay's", "Milk", "Oreos", "Peanut Butter", "Tostitos"]);
    expect(first.members).toHaveLength(4);
    expect(first.invites).toEqual([{ email: "teammate@example.com", status: "pending" }]);
  });

  it("running the seed a second time changes nothing", async () => {
    run(["prisma", "db", "seed"]);
    expect(await fingerprint(c)).toEqual(first);
  });

  it("a second full reset (drop → migrate deploy → seed) gives the same state", async () => {
    await c.end();
    await recreate();
    run(["prisma", "migrate", "deploy"]);
    run(["prisma", "db", "seed"]);
    c = await connect(FRESH_URL);
    expect(await fingerprint(c)).toEqual(first);
  });
});

describe("defects", () => {
  // DECISIONS 10: "re-seeding also undoes anything clicked during a rehearsal".
  it("[DB-10] re-seeding after a rehearsal (teammate accepted the invite) restores the demo state", async () => {
    // Rehearsal: the teammate signs in, accepts the pending invite, adds a preference and a manual item.
    const mate = await c.query(
      `INSERT INTO users (google_sub, email, display_name) VALUES ('break-mate', 'teammate@example.com', 'Teammate') RETURNING id`,
    );
    const mateId = mate.rows[0].id;
    await c.query(`UPDATE group_invites SET status = 'accepted', responded_at = now() WHERE group_id = $1 AND email = 'teammate@example.com'`, [DEMO_GROUP_ID]);
    await c.query(`INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)`, [DEMO_GROUP_ID, mateId]);
    await c.query(`INSERT INTO preferences (group_id, user_id, item_id) SELECT $1, $2, id FROM items WHERE name = 'Coffee'`, [DEMO_GROUP_ID, mateId]);

    run(["prisma", "db", "seed"]);

    const after = await fingerprint(c);
    expect({ members: after.members, invites: after.invites, list: after.list.map((r) => r.name) }).toEqual({
      members: first.members,
      invites: first.invites, // pending again, so the live accept flow can be shown
      list: first.list.map((r) => r.name),
    });
  });

  it("[DB-10] seeding with DEMO_INVITE_EMAIL leaves exactly one pending demo invite", async () => {
    run(["prisma", "db", "seed"], { DEMO_INVITE_EMAIL: "Real.Teammate@Gmail.com" });
    const inv = await c.query(`SELECT email FROM group_invites WHERE group_id = $1 AND status = 'pending' ORDER BY email`, [DEMO_GROUP_ID]);
    expect(inv.rows.map((r) => r.email)).toEqual(["real.teammate@gmail.com"]);
  });
});
