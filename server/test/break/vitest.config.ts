import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { TEST_DATABASE_URL } from "../../vitest.config.js";

/**
 * API break tests (backend-breaker). Tests that expose a defect FAIL on purpose until it is fixed, so this suite is
 * excluded from `npm test`; run it with `npm run test:break`. Same database safety rules as the main suite: the
 * shared globalSetup migrates + reseeds the test database and refuses any database whose name doesn't end in `_test`.
 * Every external service is stubbed inside the tests (see test/break/helpers.ts `guardNetwork`).
 */
export default defineConfig({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  test: {
    include: ["test/break/**/*.test.ts"],
    globalSetup: ["test/globalSetup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
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
      AKAMAI_BASE_URL: "",
      OPENFDA_API_KEY: "",
    },
  },
});
