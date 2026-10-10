import type { ErrorRequestHandler, RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const send = (status: number, code: string, message: string) =>
    res.status(status).json({ error: { code, message } });

  if (err instanceof AppError) return send(err.status, err.code, err.message);
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    return send(400, "VALIDATION_ERROR", message);
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return send(409, "CONFLICT", "A record with these values already exists");
  }
  // Client errors raised by express.json (malformed JSON, body too large).
  if (err?.expose && typeof err.status === "number" && err.status < 500) {
    if (err.type === "entity.parse.failed") return send(400, "VALIDATION_ERROR", "Malformed JSON body");
    if (err.status === 413) return send(413, "PAYLOAD_TOO_LARGE", "Request body too large");
    return send(err.status, "BAD_REQUEST", err.message);
  }

  req.log.error({ err }, "unhandled error");
  return send(500, "INTERNAL", "Internal server error");
};
