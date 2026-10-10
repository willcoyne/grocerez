import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { api, cleanup, makeUser, mkItem } from "./helpers.js";

// The item catalog is global (GAPS #10), so a write from one household changes what every other household sees.
afterAll(cleanup);

describe("catalog aliases across households", () => {
  it("[DEFECT M2-07] any user can alias arbitrary, unrelated text to any item; other households then get it as an exact match", async () => {
    const [mallory, alice] = [await makeUser(), await makeUser()];
    const apples = await mkItem("Apples", "produce");
    const t = randomUUID().replace(/[\d-]/g, "").slice(0, 8);
    const text = `peanut butter cookies ${t}`; // nothing like "apples": no search would ever suggest it
    const sug = await api().get("/api/items/search").query({ q: text }).set(mallory.auth).expect(200);
    expect(sug.body.results.map((r: { id: string }) => r.id)).not.toContain(apples.id);

    const res = await api().post("/api/items").set(mallory.auth).send({ name: text, aliasOf: apples.id });
    expect([res.status, res.body.error?.code]).toEqual([400, "ALIAS_NOT_SUGGESTED"]); // fix (DECISIONS M2)

    // backend/04 step 3: aliasOf means "the user confirmed a suggestion". The server should only accept an alias for an
    // item the search actually suggested for that text (or otherwise refuse it).
    const r = await api().get("/api/items/search").query({ q: text }).set(alice.auth).expect(200);
    expect(r.body.match === "exact" && r.body.results[0].id === apples.id, "Alice's 'peanut butter cookies' silently resolves to Apples").toBe(false);
  });
});
