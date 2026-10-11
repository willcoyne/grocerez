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
 * Recipe titles that aren't a dinner (challenge 01 §12 search). Postgres ARE regex (`\m` / `\M` = word start/end),
 * matched case-insensitively with `title !~* …`. A title is excluded only when it ENDS with one of these nouns
 * (optionally followed by "Recipe" and/or a parenthetical) and no connector ("with", "in", "and", …) comes before it:
 * "Homemade Pizza Sauce" is excluded, "Pasta with Tomato Sauce" and "Spaghetti and Meat Sauce" are kept.
 * Look-behinds keep real dinners: chicken pot pie, crab cakes, egg rolls, French dip.
 */
const NON_DINNER_NOUNS = [
  "sauces?", "dressings?", "(?<!french )dips?", "marinades?", "seasonings?", "spice (?:blends?|rubs?|mix(?:es)?)", "rubs?",
  "vinaigrettes?", "grav(?:y|ies)", "stocks?", "broths?",
  "cookies?",
  "(?<!crab |fish |salmon |tuna |potato |rice |corn |zucchini |shrimp |chicken |turkey |veggie |vegetable |bean |quinoa )cakes?",
  "cupcakes?", "brownies?", "blondies?",
  "muffins?", "(?<!pot |shepherd's |shepherds |cottage |meat |hand |chicken |turkey |tamale )pies?",
  "frostings?", "icings?", "jams?", "jell(?:y|ies)", "smoothies?", "cocktails?", "drinks?", "lemonades?",
  "breads?", "(?:dinner|cinnamon|crescent|sweet|yeast|hawaiian|bread) rolls?", "biscuits?", "granola", "pancakes?", "waffles?", "oatmeal",
  "condiments?", "ketchup", "mayo(?:nnaise)?", "aioli", "relish(?:es)?", "chutneys?", "salsas?", "pesto", "hummus",
  "bars?", "fudge", "puddings?", "syrups?", "glazes?", "butters?", "doughs?", "crusts?",
];
const NON_DINNER_CONNECTORS = "(?:with|in|on|over|and|plus|topped|served)";
const NON_DINNER_TITLE =
  `^(?:(?!\\m${NON_DINNER_CONNECTORS}\\M|&).)*\\m(?:${NON_DINNER_NOUNS.join("|")})\\M(?:\\W+recipe)?\\W*(?:\\([^)]*\\)\\W*)?$`;

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
  /** Pantry Agent recipe search: titles matching this (Postgres regex, case-insensitive) are not dinners. */
  RECIPE_NON_DINNER_TITLE: z.string().min(1).default(NON_DINNER_TITLE),
  /**
   * Recipe course rule (spec §12.1), Postgres regexes over the lower-cased recipeCategory list: a course matching MAIN
   * keeps the recipe (even if it also says "side dish"); otherwise one matching EXCLUDED drops it; otherwise (empty or
   * unknown course) the title non-dinner filter decides.
   */
  RECIPE_MAIN_COURSE: z
    .string()
    .min(1)
    .default("\\m(main( course| dish)?|mains|dinners?|entr[eé]es?|lunch(es)?|soups?|salads?|stews?|curr(y|ies)|pastas?)\\M"),
  RECIPE_EXCLUDED_COURSE: z
    .string()
    .min(1)
    .default(
      "\\m(sides?( dish(es)?)?|appetizers?|starters?|desserts?|breakfasts?|brunch(es)?|snacks?|drinks?|beverages?|sauces?|condiments?|dips?|breads?|baking)\\M",
    ),
  /** Cosine distance cutoff for "related" items (0 = identical, 2 = opposite). */
  SEMANTIC_MAX_DISTANCE: z.coerce.number().positive().max(2).default(0.35),
  /** For a matched item: other-type items must be at least this close (same product type always qualifies). */
  SEMANTIC_ITEM_MAX_DISTANCE: z.coerce.number().positive().max(2).default(0.24),
  /** Ingredient verification fallback: the nearest catalog item within this cosine distance counts as what the ingredient is. */
  // Tuned with the real Akamai model + the grocery-item query instruction: true matches landed at 0.23-0.39
  // (Herbs→Parsley 0.235, Shiitake→Mushrooms 0.345, Coconut Aminos→Coconut Milk 0.354, Grape Tomatoes in Half→Tomatoes 0.391);
  // junk at 0.46+ (Gravel 0.463, Unobtainium Dust 0.552).
  SEMANTIC_INGREDIENT_MAX_DISTANCE: z.coerce.number().positive().max(2).default(0.4),
  /** For a typed query: related items must be within this distance of the closest one (drops the noisy tail). */
  SEMANTIC_RELATIVE_GAP: z.coerce.number().positive().max(2).default(0.08),
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

const PROD_REQUIRED = ["AWS_REGION", "S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"] as const;

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
