import type { RequestHandler } from "express";
import type { ZodType } from "zod";

type Schemas = { body?: ZodType; query?: ZodType; params?: ZodType };

// Replaces req.body/query/params with the parsed (coerced, stripped) values.
// ZodErrors go to errorHandler as 400 VALIDATION_ERROR.
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
    if (schemas.query) {
      // Express 5 exposes req.query as a getter, so redefine it.
      Object.defineProperty(req, "query", { value: schemas.query.parse(req.query), writable: true });
    }
    if (schemas.body) req.body = schemas.body.parse(req.body);
    next();
  };
