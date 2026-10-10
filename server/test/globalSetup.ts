import { execSync } from "node:child_process";
import { TEST_DATABASE_URL } from "../vitest.config.js";

/**
 * Brings the test database (default: grocerez_test on the local compose Postgres) up to date and re-seeds it,
 * so every run starts from the documented demo state. The dev database is never touched.
 * Create it once with:
 *   docker compose exec postgres psql -U grocerez -d postgres -c 'CREATE DATABASE grocerez_test'
 */
export default function setup() {
  if (!/grocerez_test|_test\b/.test(TEST_DATABASE_URL)) {
    throw new Error(`Refusing to run tests against a non-test database: ${TEST_DATABASE_URL}`);
  }
  const env = { ...process.env, DATABASE_URL: TEST_DATABASE_URL, MIGRATE_DATABASE_URL: TEST_DATABASE_URL };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx prisma db seed", { env, stdio: "pipe" });
}
