// Attack 8: security. Least-privilege app role (plan database/11 step 1) and injection hygiene (step 4).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { connect, tryQuery, urlFor } from "./helpers.js";

const SERVER_DIR = new URL("../../", import.meta.url).pathname;
const APP_ROLE_SQL = readFileSync(join(SERVER_DIR, "prisma/sql/app-role.sql"), "utf8");

/** Runs prisma/sql/app-role.sql without psql: drops psql meta-commands, expands \gexec, uses the local-dev password. */
async function applyAppRole(owner: pg.Client) {
  let buf = "";
  for (const raw of APP_ROLE_SQL.split("\n")) {
    const line = raw.replace(/--.*$/, "").trimEnd();
    if (/^\s*\\/.test(line) || line.trim() === "") continue; // \if, \set, \echo, \endif
    buf += line.replace(/:'app_password'/g, "'grocerez_app'") + "\n";
    if (buf.trimEnd().endsWith("\\gexec")) {
      const r = await owner.query(buf.trimEnd().slice(0, -"\\gexec".length));
      for (const row of r.rows) await owner.query(Object.values(row)[0] as string);
      buf = "";
    } else if (buf.trimEnd().endsWith(";")) {
      await owner.query(buf);
      buf = "";
    }
  }
}

let owner: pg.Client;
let app: pg.Client;
beforeAll(async () => {
  owner = await connect();
  await applyAppRole(owner);
  app = await connect(urlFor({ user: "grocerez_app", password: "grocerez_app" }));
  await app.query("BEGIN");
});
afterAll(async () => {
  await app?.query("ROLLBACK").catch(() => {});
  await app?.end();
  await owner?.end();
});

describe("app role grocerez_app (expected to hold)", () => {
  it.each([
    "DROP TABLE users",
    "DROP TABLE items CASCADE",
    "TRUNCATE users",
    "TRUNCATE shopping_list_items",
    "ALTER TABLE users ADD COLUMN pwned text",
    "ALTER TABLE items DROP CONSTRAINT items_normalized_name_chk",
    "CREATE TABLE pwned (x int)",
    "CREATE SCHEMA pwned",
    "CREATE EXTENSION IF NOT EXISTS dblink",
    "CREATE OR REPLACE FUNCTION normalize_item_name(input text) RETURNS text LANGUAGE sql AS $$ SELECT input $$",
    "DROP FUNCTION search_items(text, integer)",
    "DROP TRIGGER group_members_owner_handoff ON group_members",
    "ALTER TABLE group_members DISABLE TRIGGER ALL",
    "SELECT * FROM _prisma_migrations",
    "DELETE FROM _prisma_migrations",
    "CREATE ROLE pwned",
    "ALTER ROLE grocerez_app SUPERUSER",
    "COPY users TO '/tmp/users.csv'",
    "SELECT pg_read_file('/etc/passwd')",
    "SET session_replication_role = replica",
  ])("is denied: %s", async (sql) => {
    const err = await tryQuery(app, sql);
    expect(err, sql).not.toBeNull();
    expect(err?.code).toMatch(/^(42501|42P01|0A000|22023|58P01)$/);
  });

  it("can do its job: read/write data and call the SQL functions", async () => {
    expect(await tryQuery(app, `SELECT * FROM search_items('cherios')`)).toBeNull();
    expect(await tryQuery(app, `SELECT generate_shopping_list('00000000-0000-4000-8000-000000000001')`)).toBeNull();
    expect(await tryQuery(app, `UPDATE items SET shelf_life_days = shelf_life_days WHERE normalized_name = 'milk'`)).toBeNull();
  });

  it("has statement_timeout = 15s and no dangerous role attributes", async () => {
    expect((await app.query(`SHOW statement_timeout`)).rows[0].statement_timeout).toBe("15s");
    const r = await owner.query(`SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = 'grocerez_app'`);
    expect(r.rows[0]).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false });
  });

  it("no SQL function is SECURITY DEFINER (nothing to escalate through)", async () => {
    const r = await owner.query(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                                 WHERE n.nspname = 'public' AND p.prosecdef`);
    expect(r.rows).toEqual([]);
  });
});

describe("injection hygiene (expected to hold)", () => {
  function tsFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (["node_modules", "generated", "test", "dist"].includes(f)) return [];
      return statSync(p).isDirectory() ? tsFiles(p) : /\.(ts|js|mjs)$/.test(f) ? [p] : [];
    });
  }
  const files = tsFiles(SERVER_DIR);

  it("no $queryRawUnsafe / $executeRawUnsafe / Prisma.raw in server code", () => {
    const hits = files.filter((f) => /\$(queryRaw|executeRaw)Unsafe|Prisma\.raw\(/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("no string-built SQL ($queryRaw( / $executeRaw( called with a string, or SQL keywords concatenated with +)", () => {
    const bad = /\$(queryRaw|executeRaw)\s*\(|["'`]\s*(SELECT|INSERT|UPDATE|DELETE)\b[^"'`]*["'`]\s*\+/i;
    const code = (f: string) => readFileSync(f, "utf8").replace(/^\s*\/\/.*$/gm, ""); // ignore line comments
    const hits = files.filter((f) => bad.test(code(f)));
    expect(hits).toEqual([]);
  });
});

describe("defects", () => {
  it("[DB-16] the app role cannot create objects at all (TEMP tables / functions included)", async () => {
    const tempTable = await tryQuery(app, `CREATE TEMP TABLE scratch (x int)`);
    const tempFn = await tryQuery(app, `CREATE FUNCTION pg_temp.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$`);
    expect({ tempTableDenied: tempTable !== null, tempFunctionDenied: tempFn !== null }).toEqual({
      tempTableDenied: true,
      tempFunctionDenied: true,
    });
  });

  it("[DB-17] app-role.sql refuses to run without an explicit password instead of falling back to a known one", () => {
    // Production instructions pass -v app_password=…; forgetting it silently sets the password to 'grocerez_app'.
    expect(APP_ROLE_SQL).not.toMatch(/\\set app_password 'grocerez_app'/);
  });
});
