import "dotenv/config";
import { z } from "zod";

const csv = z
  .string()
  .min(1)
  .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(z.string()).min(1));

/** Optional secret: empty strings count as "not set". */
const optional = z
  .string()
  .optional()
  .transform((s) => (s && s.trim() ? s.trim() : undefined));

/**
 * Environment schema. Core variables are always required. The external-service credentials
 * (Anthropic, AWS) are required in production only; in development/test the features that need them
 * answer 503 NOT_CONFIGURED instead, so the M2 loop runs before those accounts exist.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, "must be at least 16 characters"),
  GOOGLE_CLIENT_IDS: csv,
  APP_LINK_BASE: z.string().min(1).default("grocerez://"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:8081,http://localhost:19006")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  ANTHROPIC_API_KEY: optional,
  AWS_REGION: optional,
  S3_BUCKET: optional,
  AWS_ACCESS_KEY_ID: optional,
  AWS_SECRET_ACCESS_KEY: optional,
  RESEND_API_KEY: optional,
  RESEND_FROM: optional,
  OPENFDA_API_KEY: optional,
  CONTACT_EMAIL: z.string().default("team@grocerez.app"),
  /** If set in production, /api/dev/login-as is mounted and requires header `x-demo-key: <DEMO_KEY>`. */
  DEMO_KEY: optional,
  /** Pantry Agent service (challenge 01). Unset → POST /agent/runs answers 503 NOT_CONFIGURED and the app falls back to /recipes. */
  AGENT_URL: optional,
  /** Shared secret for server ↔ agent calls (X-Agent-Secret). Required (≥ 32 chars) when AGENT_URL is set. */
  AGENT_SHARED_SECRET: optional,
  /** API base the agent calls for its tools (it runs next to the server). */
  AGENT_PUBLIC_API_URL: z.string().min(1).default("http://localhost:3000/api"),
  ENABLE_JOBS: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

const PROD_REQUIRED = ["ANTHROPIC_API_KEY", "AWS_REGION", "S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"] as const;

export type Config = z.infer<typeof schema>;

export class ConfigError extends Error {}

/** Parses an environment object; throws ConfigError listing every missing or invalid variable. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = schema.safeParse(env);
  const problems: string[] = [];
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "(root)";
      problems.push(`${key}: ${env[key] === undefined ? "missing" : issue.message}`);
    }
  } else {
    if (parsed.data.NODE_ENV === "production") {
      for (const key of PROD_REQUIRED) if (!parsed.data[key]) problems.push(`${key}: missing (required in production)`);
    }
    if (parsed.data.AGENT_URL && (parsed.data.AGENT_SHARED_SECRET ?? "").length < 32) {
      problems.push("AGENT_SHARED_SECRET: must be at least 32 characters when AGENT_URL is set");
    }
  }
  if (problems.length || !parsed.success) {
    throw new ConfigError(`Invalid environment configuration:\n  - ${problems.join("\n  - ")}\nSee server/.env.example.`);
  }
  return parsed.data;
}

function init(): Config {
  try {
    return loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

export const config: Config = init();
