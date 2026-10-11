import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` } });
};

function errType(err: unknown): string | undefined {
  return err && typeof err === "object" && "type" in err ? String((err as { type: unknown }).type) : undefined;
}

function prismaCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string") {
    const code = (err as { code: string }).code;
    if (/^P\d{4}$/.test(code)) return code;
  }
  return undefined;
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) },
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request is invalid",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
    return;
  }
  if (errType(err) === "entity.parse.failed") {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Body is not valid JSON" } });
    return;
  }
  if (errType(err) === "entity.too.large") {
    res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Body is too large" } });
    return;
  }
  const pc = prismaCode(err);
  if (pc === "P2002") {
    res.status(409).json({ error: { code: "CONFLICT", message: "That already exists" } });
    return;
  }
  if (pc === "P2025") {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
    return;
  }
  logger.error({ err, method: req.method, path: req.path }, "unhandled error");
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong" } });
};
