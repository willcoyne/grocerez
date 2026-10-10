import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../src/app.js";
import { ConfigError, loadConfig } from "../src/config.js";
import { AppError } from "../src/lib/errors.js";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler.js";
import { validate } from "../src/middleware/validate.js";

const app = createApp();

describe("01 server setup", () => {
  it("GET /api/health returns {ok:true} after SELECT 1", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("unknown routes return the standard 404 error shape", async () => {
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("malformed JSON returns 400 VALIDATION_ERROR", async () => {
    const res = await request(app).post("/api/health").set("content-type", "application/json").send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("validate() turns an invalid body into 400 VALIDATION_ERROR and AppError into its status", async () => {
    const mini = express();
    mini.use(express.json());
    mini.post("/x", validate({ body: z.object({ name: z.string().min(1) }) }), (req, res) => res.json(req.body));
    mini.get("/boom", () => {
      throw new AppError(418, "TEAPOT", "short and stout");
    });
    mini.use(notFoundHandler);
    mini.use(errorHandler);

    const bad = await request(mini).post("/x").send({ name: 3 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
    expect(bad.body.error.details[0].path).toBe("name");

    const ok = await request(mini).post("/x").send({ name: "a", extra: 1 });
    expect(ok.body).toEqual({ name: "a" });

    const teapot = await request(mini).get("/boom");
    expect(teapot.status).toBe(418);
    expect(teapot.body).toEqual({ error: { code: "TEAPOT", message: "short and stout" } });
  });

  it("a missing env variable fails config loading with a clear message", () => {
    const env = { DATABASE_URL: "postgresql://x", GOOGLE_CLIENT_IDS: "a" } as NodeJS.ProcessEnv;
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(/JWT_SECRET: missing/);
  });

  it("production requires the external-service secrets", () => {
    const env = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://x",
      JWT_SECRET: "x".repeat(32),
      GOOGLE_CLIENT_IDS: "a",
    } as NodeJS.ProcessEnv;
    expect(() => loadConfig(env)).toThrow(/ANTHROPIC_API_KEY: missing/);
    const ok = loadConfig({ ...env, NODE_ENV: "development" });
    expect(ok.GOOGLE_CLIENT_IDS).toEqual(["a"]);
    expect(ok.PORT).toBe(3000);
  });
});
