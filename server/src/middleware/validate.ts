import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { AppError } from "../lib/errors.js";

type Schemas = { body?: ZodType; query?: ZodType; params?: ZodType };

// C0 control characters other than tab/newline/CR. Postgres rejects NUL in text (500), the rest is never valid input.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

// Walks a parsed (schema-shaped, so bounded-depth) value for strings with control characters.
const hasControlChars = (v: unknown): boolean =>
  typeof v === "string"
    ? CONTROL_CHARS.test(v)
    : v !== null && typeof v === "object" && Object.values(v).some(hasControlChars);

const clean = <T>(v: T): T => {
  if (hasControlChars(v)) throw new AppError(400, "VALIDATION_ERROR", "Text must not contain control characters");
  return v;
};

// Replaces req.body/query/params with the parsed (coerced, stripped) values.
// ZodErrors go to errorHandler as 400 VALIDATION_ERROR. Every validated string is also checked for control characters.
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    if (schemas.params) req.params = clean(schemas.params.parse(req.params)) as typeof req.params;
    if (schemas.query) {
      // Express 5 exposes req.query as a getter, so redefine it.
      Object.defineProperty(req, "query", { value: clean(schemas.query.parse(req.query)), writable: true });
    }
    if (schemas.body) req.body = clean(schemas.body.parse(req.body));
    next();
  };
