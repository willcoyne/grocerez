// Break tests (M3/M4): grep logs written during scan / AI / alerts requests for tokens, emails and secrets (GAPS #26).
// pino is wrapped so the app's own logger config (and redact list) runs at "info" into a buffer.
import { randomInt, randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import Anthropic from "@anthropic-ai/sdk";
import request from "supertest";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const captured: string[] = [];
vi.mock("pino", async (importOriginal) => {
  const actual = await importOriginal<typeof import("pino")>();
  const sink = new Writable({ write(chunk, _enc, cb) { captured.push(String(chunk)); cb(); } });
  const wrapped = (opts: Record<string, unknown> = {}) => actual.pino({ ...opts, level: "info" }, sink);
  return { ...actual, pino: Object.assign(wrapped, actual.pino), default: Object.assign(wrapped, actual.pino) };
});
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "93.184.216.34" }]) }));
const ai = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../../../src/modules/ai/client.js", async (orig) => ({
  ...(await orig<typeof import("../../../src/modules/ai/client.js")>()),
  getAiClient: () => ({ beta: { messages: { create: ai.create } } }),
}));

const { app } = await import("../../../src/app.js");
const { prisma } = await import("../../../src/db.js");
const { cleanupUsers, makeUser } = await import("../../helpers.js");
const { Group } = await import("../../../src/contracts/groups.js");

const email = `logs-${randomUUID()}@example.com`;
const tag = randomUUID().replace(/[^a-f]/g, "").slice(0, 6) + "zl";
const gtin = `9${String(randomInt(1e11)).padStart(12, "0")}`;
let user: Awaited<ReturnType<typeof makeUser>>;

beforeAll(async () => {
  user = await makeUser(email);
});
afterAll(async () => {
  await prisma.product.deleteMany({ where: { gtin } });
  await cleanupUsers();
  await prisma.item.deleteMany({ where: { name: { endsWith: ` ${tag}` } } });
});

it("no token, email, Anthropic key or AWS secret in logs from scan / AI / alerts failures", async () => {
  vi.stubGlobal("fetch", vi.fn(async (u: string | URL) => {
    const url = String(u);
    if (url.includes("openfoodfacts.org/api")) {
      return new Response(JSON.stringify({ status: 1, product: { code: gtin, product_name: `Logbar ${tag}`, image_front_url: "https://images.openfoodfacts.org/x.jpg" } }));
    }
    throw new Error(`connect ECONNREFUSED for ${url}`); // image copy fails
  }));
  await request(app).post("/api/products/scan").set(user.auth).send({ gtin }).expect(200);
  await request(app).post("/api/products/scan").set(user.auth).send({ qrUrl: `https://smartlabel.org/?email=${encodeURIComponent(email)}&token=${user.token}` });

  const g = Group.parse((await request(app).post("/api/groups").set(user.auth).send({ name: "Logs" }).expect(201)).body);
  const item = await prisma.item.create({ data: { name: `Logitem ${tag}`, normalizedName: `logitem ${tag}` } });
  await prisma.shoppingListItem.create({ data: { groupId: g.id, itemId: item.id, reason: "manual" } });
  await prisma.cabinetItem.create({ data: { groupId: g.id, itemId: item.id, addedBy: user.id } });
  ai.create.mockRejectedValue(new Anthropic.AuthenticationError(401, { type: "error", error: { message: `bad key ${process.env.ANTHROPIC_API_KEY}` } }, "invalid x-api-key", new Headers({ "request-id": "req_1" })));
  await request(app).post(`/api/groups/${g.id}/shopping-list/prices`).set(user.auth).send({ zipCode: "10001" }).expect(503);
  await request(app).post(`/api/groups/${g.id}/recipes/suggest`).set(user.auth).send({}).expect(503);
  await request(app).get(`/api/groups/${g.id}/alerts?email=${encodeURIComponent(email)}`).set(user.auth).expect(200);

  const logs = captured.join("");
  expect(logs.length).toBeGreaterThan(0);
  expect(logs).toContain("product image copy failed"); // the failure paths really logged
  expect(logs).not.toContain(user.token);
  expect(logs).not.toContain(email);
  expect(logs).not.toContain(process.env.AWS_SECRET_ACCESS_KEY === "test" ? "AWS_SECRET" : process.env.AWS_SECRET_ACCESS_KEY!);
  expect(logs).not.toMatch(/Bearer\s+ey/);
  expect(logs).not.toContain(process.env.JWT_SECRET!);
});
