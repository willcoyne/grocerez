// Prisma 7 config: connection URL, migrations folder and seed command live here (not in schema.prisma / package.json).
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations and the seed run as the table owner. In production DATABASE_URL is the least-privilege
    // grocerez_app role (prisma/sql/app-role.sql), so set MIGRATE_DATABASE_URL to the owner connection there.
    url: process.env["MIGRATE_DATABASE_URL"] ?? process.env["DATABASE_URL"],
  },
});
