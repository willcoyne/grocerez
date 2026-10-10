import type { RequestHandler } from "express";
import type { ZodType } from "zod";

type Schemas = { body?: ZodType; query?: ZodType; params?: ZodType };

/**
 * Validates and replaces req.body / req.query / req.params with the parsed (coerced, defaulted) values.
 * A failure throws the ZodError, which errorHandler turns into 400 VALIDATION_ERROR.
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
    if (schemas.query) {
      // Express 5 exposes req.query as a getter; shadow it with the parsed value.
      Object.defineProperty(req, "query", { value: schemas.query.parse(req.query), writable: true, configurable: true });
    }
    if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
    next();
  };
}
