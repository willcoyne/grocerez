import { spawnSync } from "node:child_process";
import express from "express";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { app } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { prisma } from "../src/db.js";
import { AppError } from "../src/lib/errors.js";
import { errorHandler } from "../src/middleware/errorHandler.js";
import { validate } from "../src/middleware/validate.js";

afterAll(() => prisma.$disconnect());

describe("GET /api/health", () => {
  it("returns ok after querying the database", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("unknown routes return 404 NOT_FOUND", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("malformed JSON returns 400 VALIDATION_ERROR", async () => {
    const res = await request(app).post("/api/health").set("content-type", "application/json").send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("config", () => {
  it("names every missing variable", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL[\s\S]*JWT_SECRET[\s\S]*GOOGLE_CLIENT_IDS/);
  });

  it("splits GOOGLE_CLIENT_IDS", () => {
    expect(loadConfig({ ...process.env, GOOGLE_CLIENT_IDS: "a, b," }).GOOGLE_CLIENT_IDS).toEqual(["a", "b"]);
  });

  it("server refuses to start with a missing variable", () => {
    const { JWT_SECRET: _omit, ...env } = process.env;
    const out = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts"], {
      env: { ...env, DOTENV_CONFIG_PATH: "does-not-exist.env" },
      encoding: "utf8",
      timeout: 20000,
    });
    expect(out.status).toBe(1);
    expect(out.stderr).toMatch(/Invalid environment configuration[\s\S]*JWT_SECRET/);
  });
});

describe("validate + errorHandler", () => {
  const t = express();
  t.use(express.json());
  t.use((req, _res, next) => {
    (req as any).log = { error() {} };
    next();
  });
  t.post("/t/:id", validate({ body: z.object({ name: z.string().min(1) }), params: z.object({ id: z.uuid() }) }), (req, res) => {
    res.json(req.body);
  });
  t.get("/q", validate({ query: z.object({ n: z.coerce.number() }) }), (req, res) => {
    res.json(req.query);
  });
  t.get("/app-error", () => {
    throw new AppError(403, "FORBIDDEN", "nope");
  });
  t.get("/boom", () => {
    throw new Error("secret details");
  });
  t.use(errorHandler);
  const id = "00000000-0000-4000-8000-000000000000";

  it("invalid body returns 400 VALIDATION_ERROR", async () => {
    const res = await request(t).post(`/t/${id}`).send({ name: 5 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("invalid params return 400", async () => {
    const res = await request(t).post("/t/not-a-uuid").send({ name: "x" });
    expect(res.status).toBe(400);
  });

  it("valid body is parsed and unknown keys stripped", async () => {
    const res = await request(t).post(`/t/${id}`).send({ name: "milk", extra: 1 });
    expect(res.body).toEqual({ name: "milk" });
  });

  it("query is coerced", async () => {
    const res = await request(t).get("/q?n=3");
    expect(res.body).toEqual({ n: 3 });
  });

  it("AppError keeps its status and code", async () => {
    const res = await request(t).get("/app-error");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: "FORBIDDEN", message: "nope" } });
  });

  it("unknown errors become 500 without leaking details", async () => {
    const res = await request(t).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: "INTERNAL", message: "Internal server error" } });
  });
});
