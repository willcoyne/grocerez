import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  PORT: z.coerce.number().int().positive(),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  GOOGLE_CLIENT_IDS: z
    .string()
    .min(1)
    .transform((s) => s.split(",").map((id) => id.trim()).filter(Boolean)),
  ANTHROPIC_API_KEY: z.string().min(1),
  AWS_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  APP_LINK_BASE: z.string().min(1),
  RESEND_API_KEY: z.string().optional().transform((s) => s || undefined),
  // Optional: raises the openFDA rate limit for the daily recall import (backend/09).
  OPENFDA_API_KEY: z.string().optional().transform((s) => s || undefined),
  // Number of reverse proxies in front of the server (Railway / Cloud Run: 1). 0 or unset = trust none.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration (see server/.env.example):\n${lines.join("\n")}`);
  }
  return result.data;
}

export const config: Config = (() => {
  try {
    return loadConfig(process.env);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
})();
