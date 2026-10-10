import { defineConfig } from "vitest/config";

// The break tests share one local database (seeded demo state), so files run one at a time.
export default defineConfig({
  test: {
    include: ["test/db-break/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
