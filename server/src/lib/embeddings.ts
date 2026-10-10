import { config } from "../config.js";
import { AppError } from "./errors.js";
import { http, USER_AGENT } from "./http.js";

/**
 * Akamai embedding client (semantic item search). The endpoint is OpenAI-compatible:
 * POST {input: string[], model} → {data: [{index, embedding: number[]}]}.
 */
export const embeddingsConfigured = () => Boolean(config.AKAMAI_API_KEY && config.AKAMAI_EMBEDDING_URL);

export const embeddingModel = () => config.AKAMAI_EMBEDDING_MODEL;

/** Text embedded for a catalog item. Including the category gives the model context ("Oreos (snacks)"). */
export const itemEmbeddingText = (item: { name: string; category: string | null }) =>
  item.category ? `${item.name} (${item.category})` : item.name;

/** pgvector literal, e.g. "[0.1,0.2]". */
export const toVectorLiteral = (v: number[]) => `[${v.join(",")}]`;

export async function embed(texts: string[]): Promise<number[][]> {
  if (!embeddingsConfigured()) throw new AppError(503, "NOT_CONFIGURED", "Akamai embeddings are not configured");
  if (texts.length === 0) return [];
  const res = await http.fetch(config.AKAMAI_EMBEDDING_URL!, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.AKAMAI_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT(),
    },
    body: JSON.stringify({ model: embeddingModel(), input: texts }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new AppError(502, "UPSTREAM_ERROR", `Akamai embeddings returned ${res.status}`);
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

/** Search queries repeat while typing; keep recent query embeddings in memory (insertion-ordered LRU). */
const queryCache = new Map<string, number[]>();
const QUERY_CACHE_MAX = 500;

export async function embedQuery(normalizedQuery: string): Promise<number[]> {
  const key = `${embeddingModel()}:${normalizedQuery}`;
  const hit = queryCache.get(key);
  if (hit) {
    queryCache.delete(key);
    queryCache.set(key, hit);
    return hit;
  }
  const [vector] = await embed([normalizedQuery]);
  queryCache.set(key, vector);
  if (queryCache.size > QUERY_CACHE_MAX) queryCache.delete(queryCache.keys().next().value!);
  return vector;
}

export const clearQueryEmbeddingCache = () => queryCache.clear();
