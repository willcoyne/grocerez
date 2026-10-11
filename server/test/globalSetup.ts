import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import pg from "pg";
import { TEST_DATABASE_URL } from "../vitest.config.js";

const DEMO_GROUP_ID = "00000000-0000-4000-8000-000000000001";

/**
 * Brings the test database (default: grocerez_test on the local compose Postgres) up to date, removes everything
 * earlier test runs created, and re-seeds it, so every run starts from the documented demo state.
 * The dev database is never touched. Create the test database once with `npm run db:test:setup`.
 */
export default async function setup() {
  if (!/_test(\?|$)/.test(TEST_DATABASE_URL)) {
    throw new Error(`Refusing to run tests against a non-test database: ${TEST_DATABASE_URL}`);
  }
  const env = { ...process.env, DATABASE_URL: TEST_DATABASE_URL, MIGRATE_DATABASE_URL: TEST_DATABASE_URL };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });

  const seedNames = (JSON.parse(readFileSync(new URL("../prisma/seed/items.json", import.meta.url), "utf8")) as { name: string }[])
    .map((i) => i.name);
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM groups WHERE id <> $1", [DEMO_GROUP_ID]);
    for (const t of ["preferences", "cabinet_items", "shopping_list_items"]) {
      await client.query(`DELETE FROM ${t} WHERE group_id = $1`, [DEMO_GROUP_ID]);
    }
    await client.query("DELETE FROM group_invites WHERE group_id = $1", [DEMO_GROUP_ID]);
    await client.query("DELETE FROM group_members WHERE group_id = $1 AND user_id::text NOT LIKE '00000000-0000-4000-8000-0000000001%'", [DEMO_GROUP_ID]);
    await client.query("DELETE FROM products");
    await client.query("DELETE FROM price_estimates");
    await client.query("DELETE FROM item_aliases");
    await client.query("DELETE FROM recalls WHERE source <> 'demo'");
    await client.query(
      "DELETE FROM items WHERE normalized_name <> ALL (SELECT normalize_item_name(n) FROM unnest($1::text[]) n)",
      [seedNames],
    );
    await client.query("DELETE FROM users WHERE google_sub NOT LIKE 'seed-user-%'");
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
  execSync("npx prisma db seed", { env, stdio: "pipe" });
}
