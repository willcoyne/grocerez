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
 * Environment schema. Core variables are always required. External-service credentials (Akamai, Anthropic,
 * S3 / Linode Object Storage) are optional in every environment: the features that need them answer
 * 503 NOT_CONFIGURED, so the Linode deployment starts with whatever keys the team has.
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
  /** S3-compatible endpoint for non-AWS storage, e.g. Linode Object Storage https://us-ord-1.linodeobjects.com. */
  S3_ENDPOINT: optional,
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
  /** For a matched item: other-type items must be at least this close (same product type always qualifies). */
  SEMANTIC_ITEM_MAX_DISTANCE: z.coerce.number().positive().max(2).default(0.24),
  /** For a typed query: related items must be within this distance of the closest one (drops the noisy tail). */
  SEMANTIC_RELATIVE_GAP: z.coerce.number().positive().max(2).default(0.08),
  CONTACT_EMAIL: z.string().default("team@grocerez.app"),
  /** If set in production, /api/dev/login-as is mounted and requires header `x-demo-key: <DEMO_KEY>`. */
  DEMO_KEY: optional,
  ENABLE_JOBS: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

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
