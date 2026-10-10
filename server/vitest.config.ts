import { defineConfig } from "vitest/config";

// Stub values so tests never need real secrets. Postgres comes from docker-compose.yml.
export default defineConfig({
  test: {
    // DB-heavy route tests run 20+ files in parallel against one Postgres; 5s default flakes under load.
    testTimeout: 20_000,
    env: {
      NODE_ENV: "test",
      PORT: "3999",
      DATABASE_URL: "postgresql://grocerez:grocerez@localhost:5432/grocerez",
      JWT_SECRET: "test-secret-test-secret-test-secret-123",
      GOOGLE_CLIENT_IDS: "test-client-id",
      ANTHROPIC_API_KEY: "test",
      AWS_REGION: "us-east-1",
      S3_BUCKET: "test-bucket",
      AWS_ACCESS_KEY_ID: "test",
      AWS_SECRET_ACCESS_KEY: "test",
      APP_LINK_BASE: "grocerez://",
    },
  },
});
