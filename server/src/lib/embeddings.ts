import { config } from "../config.js";
import { AppError } from "./errors.js";
import { http, USER_AGENT } from "./http.js";

/**
 * Akamai AI client for semantic item search. Both endpoints are OpenAI-compatible under AKAMAI_BASE_URL:
 *   POST /embeddings        {model, input: string[]} → {data: [{index, embedding: number[]}]}
 *   POST /chat/completions  {model, messages}        → {choices: [{message: {content}}]}
 */
export const embeddingsConfigured = () => Boolean(config.AKAMAI_API_KEY && config.AKAMAI_BASE_URL);

export const embeddingModel = () => config.AKAMAI_EMBEDDING_MODEL;

export type ItemSemantics = { productType: string | null; description: string | null };

/**
 * Text embedded for a catalog item: "product type: description" ("cookies: Chocolate sandwich cookies").
 * The small embedding model can't infer what a brand is, and leading with the generic type keeps cookies
 * apart from candy and chips. Falls back to the name when the chat model gave nothing.
 */
export const itemEmbeddingText = (item: { name: string; category: string | null } & Partial<ItemSemantics>) =>
  item.productType && item.description
    ? `${item.productType}: ${item.description}`
    : item.description
      ? `${item.name}: ${item.description}`
      : item.category
        ? `${item.name} (${item.category})`
        : item.name;

/** pgvector literal, e.g. "[0.1,0.2]". */
export const toVectorLiteral = (v: number[]) => `[${v.join(",")}]`;

/** POST to Akamai, retrying rate limits (429) and 5xx with backoff (honoring Retry-After). */
async function akamaiPost(path: string, body: unknown, opts: { retries: number; timeoutMs: number }): Promise<Response> {
  if (!embeddingsConfigured()) throw new AppError(503, "NOT_CONFIGURED", "Akamai AI is not configured");
  const url = `${config.AKAMAI_BASE_URL!.replace(/\/+$/, "")}${path}`;
  for (let attempt = 0; ; attempt++) {
    const res = await http.fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.AKAMAI_API_KEY}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT(),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    const retryable = res.status === 429 || res.status >= 500;
    if (res.ok || !retryable || attempt >= opts.retries) {
      if (res.ok) return res;
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      throw new AppError(502, "UPSTREAM_ERROR", `Akamai ${path} returned ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, Math.min(waitMs, 10_000)));
  }
}

/** Akamai's embeddings endpoint accepts at most 16 inputs per request. */
export const EMBED_BATCH_MAX = 16;

/** Embeds up to 16 texts. Search calls pass retries: 0 so typing never waits on a backoff. */
export async function embed(texts: string[], opts: { retries?: number } = {}): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await akamaiPost(
    "/embeddings",
    { model: embeddingModel(), input: texts },
    { retries: opts.retries ?? 4, timeoutMs: 10_000 },
  );
  const body = (await res.json()) as { data?: { index?: number; embedding?: unknown }[] };
  const data = [...(body.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const vectors = data.map((d) => d.embedding);
  const valid = (v: unknown): v is number[] =>
    Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "number" && Number.isFinite(x));
  if (vectors.length !== texts.length || !vectors.every(valid) || new Set(vectors.map((v) => v.length)).size !== 1) {
    throw new AppError(502, "UPSTREAM_ERROR", "Akamai embeddings returned an unexpected response");
  }
  return vectors;
}

const DESCRIBE_PROMPT =
  "You describe grocery catalog items for a search index. For each item give: " +
  '"type": its product type, the generic noun a shopper would use for that kind of product, 1-3 words, plural, ' +
  "no brand, no flavors (e.g. Oreos -> cookies, Doritos -> tortilla chips, M&M's -> candy, Cheerios -> breakfast cereal); " +
  '"description": a short plain description of the product, at most 10 words, generic words (e.g. chocolate sandwich cookies). ' +
  'Reply with only a JSON object mapping each item name exactly as given to {"type": ..., "description": ...}.';

/** Product type + description for item names from Akamai's chat model. Missing/invalid entries are left out. */
export async function describeItems(names: string[]): Promise<Map<string, ItemSemantics>> {
  const out = new Map<string, ItemSemantics>();
  if (names.length === 0) return out;
  const res = await akamaiPost(
    "/chat/completions",
    {
      model: config.AKAMAI_CHAT_MODEL,
      temperature: 0,
      max_tokens: 60 * names.length + 100,
      messages: [
        { role: "system", content: DESCRIBE_PROMPT },
        { role: "user", content: JSON.stringify(names) },
      ],
    },
    { retries: 3, timeoutMs: 60_000 },
  );
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content ?? "";
  // The model may wrap the JSON in prose or a code fence; take the outermost {...}.
  const json = content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== "object") return out;
  const clean = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, max) : null;
  for (const name of names) {
    const entry = (parsed as Record<string, unknown>)[name];
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const productType = clean(e.type, 40)?.toLowerCase() ?? null;
    const description = clean(e.description, 120);
    if (productType || description) out.set(name, { productType, description });
  }
  return out;
}

/**
 * Qwen3-style embedding models want an instruction on the query side (items are embedded as-is).
 * Without it, "oreo" lands near Bagels and Pita; with it, near other snacks.
 */
export const QUERY_INSTRUCTION =
  "Instruct: Given a grocery item someone typed, retrieve grocery products that are the same kind of thing or a close substitute\nQuery: ";

/** Search queries repeat while typing; keep recent query embeddings in memory (insertion-ordered LRU). */
const queryCache = new Map<string, number[]>();
const QUERY_CACHE_MAX = 500;

/** Embeds what the user typed (trimmed, lower-cased; not the catalog-normalized form, which drops meaning). */
export async function embedQuery(typed: string): Promise<number[]> {
  const text = typed.trim().replace(/\s+/g, " ").toLowerCase();
  const key = `${embeddingModel()}:${text}`;
  const hit = queryCache.get(key);
  if (hit) {
    queryCache.delete(key);
    queryCache.set(key, hit);
    return hit;
  }
  const [vector] = await embed([QUERY_INSTRUCTION + text], { retries: 0 });
  queryCache.set(key, vector);
  if (queryCache.size > QUERY_CACHE_MAX) queryCache.delete(queryCache.keys().next().value!);
  return vector;
}

export const clearQueryEmbeddingCache = () => queryCache.clear();
