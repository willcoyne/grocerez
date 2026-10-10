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
  /** Akamai embedding model for semantic item search. Without a key, search falls back to spelling matches only. */
  AKAMAI_API_KEY: optional,
  /** OpenAI-compatible Akamai base URL (…/v1); /embeddings and /chat/completions are appended. */
  AKAMAI_BASE_URL: optional,
  AKAMAI_EMBEDDING_MODEL: z.string().trim().min(1).default("hackathon-embedding"),
  /** Writes the short item descriptions that embeddings are built from. */
  AKAMAI_CHAT_MODEL: z.string().trim().min(1).default("hackathon-chat"),
  /** Cosine distance cutoff for "related" items (0 = identical, 2 = opposite). */
  SEMANTIC_MAX_DISTANCE: z.coerce.number().positive().max(2).default(0.35),
  CONTACT_EMAIL: z.string().default("team@grocerez.app"),
  /** If set in production, /api/dev/login-as is mounted and requires header `x-demo-key: <DEMO_KEY>`. */
  DEMO_KEY: optional,
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
  } else if (parsed.data.NODE_ENV === "production") {
    for (const key of PROD_REQUIRED) if (!parsed.data[key]) problems.push(`${key}: missing (required in production)`);
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
