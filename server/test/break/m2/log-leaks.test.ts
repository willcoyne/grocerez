import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanup, makeUser, mkItem, type U } from "./helpers.js";

// Attack #11: run the real server (NODE_ENV=development, so pino logs at info) as a child process, drive the M2 flows
// over HTTP, and grep everything it logged for tokens, emails and secrets.
const serverDir = fileURLToPath(new URL("../../../", import.meta.url));
let child: ChildProcess;
let base = "";
let out = "";

const freePort = () =>
  new Promise<number>((r) => {
    const s = createServer().listen(0, () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => r(p));
    });
  });

beforeAll(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}/api`;
  child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: serverDir,
    env: { ...process.env, NODE_ENV: "development", PORT: String(port), RESEND_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (d) => (out += d));
  child.stderr!.on("data", (d) => (out += d));
  for (let i = 0; i < 100; i++) {
    if (out.includes("listening")) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(out).toContain("listening");
}, 30_000);
afterAll(async () => {
  child?.kill();
  await cleanup();
});

const call = (u: U, method: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${u.token}`, "Content-Type": "application/json", Cookie: "session=SECRETCOOKIE" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

describe("log leaks during M2 flows", () => {
  it("no JWTs, emails, cookies, JWT_SECRET or invite addresses appear in the server's logs", async () => {
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const stranger = `stranger-${randomUUID()}@example.com`;
    const item = await mkItem("LogItem", "dairy", ["milk"]);
    const g = (await call(a, "POST", "/groups", { name: "Logs" })).body;
    const inv = (await call(a, "POST", `/groups/${g.id}/invites`, { email: b.email })).body;
    await call(a, "POST", `/groups/${g.id}/invites`, { email: stranger });
    await call(b, "GET", "/me/invites");
    await call(b, "POST", `/invites/${inv.id}/accept`);
    await call(b, "PUT", "/me/dietary", { diets: [], allergens: ["milk"] });
    await call(a, "POST", `/groups/${g.id}/preferences`, { itemId: item.id, note: "private note" });
    const row = (await call(a, "GET", `/groups/${g.id}/shopping-list`)).body[0];
    await call(b, "PATCH", `/groups/${g.id}/shopping-list/${row.id}`, { checked: true });
    await call(a, "POST", `/groups/${g.id}/shopping-list/complete`);
    // Error paths: validation, not-found, cross-group, and an unhandled 500 (NUL byte, see M2-01).
    await call(a, "POST", `/groups/${g.id}/invites`, { email: `not-an-email ${stranger}` });
    await call(b, "GET", `/groups/${randomUUID()}/cabinet`);
    await call(a, "POST", "/groups", { name: `nul\u0000${b.email}` });
    await call(a, "DELETE", `/groups/${g.id}/members/${b.id}`);
    await new Promise((r) => setTimeout(r, 300));

    expect(out.length).toBeGreaterThan(0);
    const secrets: [string, string][] = [
      ["A's JWT", a.token], ["B's JWT", b.token], ["JWT signature", a.token.split(".")[2]], ["JWT_SECRET", process.env.JWT_SECRET!],
      ["cookie", "SECRETCOOKIE"], ["invite email (stranger)", stranger], ["note", "private note"],
    ];
    const found = secrets.filter(([, v]) => out.includes(v)).map(([k]) => k);
    expect(found, "secrets in logs").toEqual([]);
  }, 60_000);

  it("no member or invitee email appears anywhere in the logs (incl. the 500 error details)", async () => {
    // Run after the flow above; `out` holds everything the server printed.
    if (process.env.DUMP_LOGS) console.log(out.split("\n").filter((l) => l.includes("@example.com")).map((l) => l.slice(0, 1500)).join("\n---\n"));
    const emails = [...new Set(out.match(/[a-z0-9._%+-]+@example\.com/gi) ?? [])];
    expect(emails, "emails found in logs").toEqual([]);
  });
});
