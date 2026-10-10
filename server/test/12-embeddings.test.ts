import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { prisma } from "../src/db.js";
import { clearQueryEmbeddingCache } from "../src/lib/embeddings.js";
import { http } from "../src/lib/http.js";
import { itemsService } from "../src/modules/items/service.js";
import { api, makeUser } from "./helpers.js";

/** Fake Akamai model: 3 dimensions — cookies, dairy, everything else. */
const fakeVector = (text: string) => {
  const t = text.toLowerCase();
  if (/oreo|cookie|chips ahoy|biscotti/.test(t)) return [1, 0.05, 0];
  if (/milk|cheese|yogurt/.test(t)) return [0, 1, 0];
  return [0, 0, 1];
};

const ok = (input: string[]) =>
  new Response(JSON.stringify({ data: input.map((s, index) => ({ index, embedding: fakeVector(s) })) }), { status: 200 });

const original = { key: config.AKAMAI_API_KEY, url: config.AKAMAI_EMBEDDING_URL };
let firstCall: Parameters<typeof http.fetch> | undefined;

beforeAll(async () => {
  config.AKAMAI_API_KEY = "test-akamai-key";
  config.AKAMAI_EMBEDDING_URL = "https://akamai.test/v1/embeddings";
  vi.spyOn(http, "fetch").mockImplementation(async (_url, init) => ok(JSON.parse(String(init!.body)).input));
  await itemsService.embedMissing();
  firstCall = vi.mocked(http.fetch).mock.calls[0];
});

afterEach(() => clearQueryEmbeddingCache());

afterAll(async () => {
  vi.restoreAllMocks();
  config.AKAMAI_API_KEY = original.key;
  config.AKAMAI_EMBEDDING_URL = original.url;
  await prisma.$executeRaw`UPDATE items SET embedding = NULL, embedding_model = NULL, embedded_at = NULL`;
});

describe("semantic item search (Akamai embeddings)", () => {
  it("backfill embeds every catalog item with the configured model", async () => {
    const [{ missing }] = await prisma.$queryRaw<{ missing: number }[]>`
      SELECT count(*)::int AS missing FROM items WHERE embedding_model IS DISTINCT FROM 'hackathon-embedding'`;
    expect(missing).toBe(0);
    const call = firstCall!;
    expect(call[0]).toBe("https://akamai.test/v1/embeddings");
    expect((call[1]!.headers as Record<string, string>).Authorization).toBe("Bearer test-akamai-key");
    expect(JSON.parse(String(call[1]!.body)).model).toBe("hackathon-embedding");
  });

  it('"oreo" finds Oreos by spelling and Cookies / Chips Ahoy as related, not Milk', async () => {
    const u = await makeUser();
    const res = await api().get("/api/items/search").query({ q: "oreo" }).set(u.auth);
    expect(res.status).toBe(200);
    expect(res.body.results[0].name).toBe("Oreos");
    const related = res.body.related.map((i: { name: string }) => i.name);
    expect(related).toEqual(expect.arrayContaining(["Cookies", "Chips Ahoy"]));
    expect(related).not.toContain("Oreos");
    expect(related).not.toContain("Milk");
  });

  it("a newly added item gets its embedding right away", async () => {
    const u = await makeUser();
    const res = await api().post("/api/items").send({ name: "Almond Biscotti", category: "snacks" }).set(u.auth);
    expect(res.status).toBeLessThan(300);
    const [row] = await prisma.$queryRaw<{ model: string | null; dims: number | null }[]>`
      SELECT embedding_model AS model, vector_dims(embedding) AS dims FROM items WHERE id = ${res.body.id}::uuid`;
    expect(row).toEqual({ model: "hackathon-embedding", dims: 3 });
  });

  it("search still works (related = []) when Akamai fails", async () => {
    vi.mocked(http.fetch).mockResolvedValueOnce(new Response("down", { status: 503 }));
    const u = await makeUser();
    const res = await api().get("/api/items/search").query({ q: "cookie dough" }).set(u.auth);
    expect(res.status).toBe(200);
    expect(res.body.related).toEqual([]);
  });
});
