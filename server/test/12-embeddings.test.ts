import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { prisma } from "../src/db.js";
import { clearQueryEmbeddingCache } from "../src/lib/embeddings.js";
import { http } from "../src/lib/http.js";
import { itemsService, waitForItemEmbeds } from "../src/modules/items/service.js";
import { api, makeUser } from "./helpers.js";

/** Fake Akamai model: 3 dimensions — cookies, dairy, everything else. */
const fakeVector = (text: string) => {
  const t = text.toLowerCase();
  // Items are cookie-like only through their description; a query for "oreo" means cookies.
  if (/cookie|query: oreo/.test(t)) return [1, 0.05, 0];
  if (/milk|cheese|yogurt/.test(t)) return [0, 1, 0];
  return [0, 0, 1];
};

/** Fake hackathon-chat: brand names get a generic description, everything else "grocery item". */
const fakeSemantics = (name: string) =>
  /oreo|chips ahoy|biscotti|cookie/i.test(name)
    ? { type: "cookies", description: "sweet cookies" }
    : { type: "groceries", description: "grocery item" };

const fakeAkamai = async (url: string, init?: RequestInit) => {
  const body = JSON.parse(String(init!.body));
  if (url.endsWith("/chat/completions")) {
    const names: string[] = JSON.parse(body.messages[1].content);
    const content = JSON.stringify(Object.fromEntries(names.map((n) => [n, fakeSemantics(n)])));
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }
  const input: string[] = body.input;
  return new Response(JSON.stringify({ data: input.map((s, index) => ({ index, embedding: fakeVector(s) })) }), { status: 200 });
};

const original = { key: config.AKAMAI_API_KEY, url: config.AKAMAI_BASE_URL };
let firstCall: Parameters<typeof http.fetch> | undefined;
let chatCall: Parameters<typeof http.fetch> | undefined;

beforeAll(async () => {
  config.AKAMAI_API_KEY = "test-akamai-key";
  config.AKAMAI_BASE_URL = "https://akamai.test/v1";
  vi.spyOn(http, "fetch").mockImplementation(fakeAkamai);
  await itemsService.embedMissing();
  firstCall = vi.mocked(http.fetch).mock.calls.find(([url]) => url.endsWith("/embeddings"));
  chatCall = vi.mocked(http.fetch).mock.calls.find(([url]) => url.endsWith("/chat/completions"));
});

afterEach(() => clearQueryEmbeddingCache());

afterAll(async () => {
  vi.restoreAllMocks();
  config.AKAMAI_API_KEY = original.key;
  config.AKAMAI_BASE_URL = original.url;
  await prisma.$executeRaw`UPDATE items SET description = NULL, product_type = NULL, embedding = NULL, embedding_model = NULL, embedded_at = NULL`;
});

describe("semantic item search (Akamai embeddings)", () => {
  it("backfill describes (hackathon-chat) and embeds every catalog item with the configured model", async () => {
    const [{ missing }] = await prisma.$queryRaw<{ missing: number }[]>`
      SELECT count(*)::int AS missing FROM items WHERE embedding_model IS DISTINCT FROM 'hackathon-embedding'`;
    expect(missing).toBe(0);
    const call = firstCall!;
    expect(call[0]).toBe("https://akamai.test/v1/embeddings");
    expect((call[1]!.headers as Record<string, string>).Authorization).toBe("Bearer test-akamai-key");
    expect(JSON.parse(String(call[1]!.body)).model).toBe("hackathon-embedding");
    const [oreos] = await prisma.$queryRaw<{ description: string; product_type: string }[]>`
      SELECT description, product_type FROM items WHERE name = 'Oreos'`;
    expect(oreos).toEqual({ description: "sweet cookies", product_type: "cookies" });
    expect(JSON.parse(String(chatCall![1]!.body)).model).toBe("hackathon-chat");
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

  it("a newly added item gets a semantic description and embedding (in the background)", async () => {
    const u = await makeUser();
    const res = await api().post("/api/items").send({ name: "Almond Biscotti", category: "snacks" }).set(u.auth);
    expect(res.status).toBeLessThan(300);
    await waitForItemEmbeds();
    const [row] = await prisma.$queryRaw<{ model: string | null; dims: number | null; description: string | null }[]>`
      SELECT embedding_model AS model, vector_dims(embedding) AS dims, description FROM items WHERE id = ${res.body.id}::uuid`;
    expect(row).toEqual({ model: "hackathon-embedding", dims: 3, description: "sweet cookies" });
  });

  it("search still works (related = []) when Akamai fails", async () => {
    vi.mocked(http.fetch).mockResolvedValueOnce(new Response("down", { status: 503 }));
    const u = await makeUser();
    const res = await api().get("/api/items/search").query({ q: "cookie dough" }).set(u.auth);
    expect(res.status).toBe(200);
    expect(res.body.related).toEqual([]);
  });
});
