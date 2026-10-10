import { defineConfig } from "vitest/config";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://grocerez:grocerez@localhost:5432/grocerez_test";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Break tests fail on purpose until their defects are fixed; run them with `npm run test:db-break` / `npm run test:break`.
    exclude: ["test/db-break/**", "test/break/**", "**/node_modules/**"],
    globalSetup: ["test/globalSetup.ts"],
    // Tests share one real Postgres database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 120000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DATABASE_URL,
      JWT_SECRET: "test-secret-test-secret-test-secret",
      GOOGLE_CLIENT_IDS: "test-web-client.apps.googleusercontent.com,test-ios-client.apps.googleusercontent.com",
      APP_LINK_BASE: "grocerez://",
      ENABLE_JOBS: "false",
      ANTHROPIC_API_KEY: "",
      AWS_REGION: "",
      S3_BUCKET: "",
      AWS_ACCESS_KEY_ID: "",
      AWS_SECRET_ACCESS_KEY: "",
      RESEND_API_KEY: "",
      // Never call the real Akamai API from tests (server/.env may hold a real key).
      AKAMAI_API_KEY: "",
      AKAMAI_EMBEDDING_URL: "",
    },
  },
});
