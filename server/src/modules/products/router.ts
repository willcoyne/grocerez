import { Router } from "express";
import { ScanBody } from "../../contracts/products.js";
import { uid } from "../../middleware/auth.js";
import { perUser } from "../../middleware/rateLimit.js";
import { validate } from "../../middleware/validate.js";
import { productsService } from "./service.js";

export const productsRouter = Router();

/** POST /products/scan {qrUrl} | {gtin}: 30 requests/min per user. */
productsRouter.post("/products/scan", perUser(30, 60_000, "scan"), validate({ body: ScanBody }), async (req, res) => {
  res.json(await productsService.scan(uid(req), req.body));
});
