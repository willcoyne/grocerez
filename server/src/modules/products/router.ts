import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { ScanProductBody } from "../../contracts/products.js";
import { AppError } from "../../lib/errors.js";
import { validate } from "../../middleware/validate.js";
import * as service from "./service.js";

// Mounted behind requireAuth (req.userId is set).
export const productsRouter = Router();

// GAPS #22: 30 scans per minute per user.
const scanLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  keyGenerator: (req) => req.userId,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new AppError(429, "RATE_LIMITED", "Too many scans, try again in a minute")),
});

productsRouter.post("/products/scan", scanLimiter, validate({ body: ScanProductBody }), async (req, res) => {
  res.json(await service.scan(req.body, req.userId));
});
