import { Router } from "express";
import { LookupBody, ScanBody } from "../../contracts/products.js";
import { uid } from "../../middleware/auth.js";
import { perUser } from "../../middleware/rateLimit.js";
import { validate } from "../../middleware/validate.js";
import { lookupService } from "./lookup.js";
import { productsService } from "./service.js";

export const productsRouter = Router();

/** POST /products/scan {qrUrl} | {gtin}: 30 requests/min per user. */
productsRouter.post("/products/scan", perUser(30, 60_000, "scan"), validate({ body: ScanBody }), async (req, res) => {
  res.json(await productsService.scan(uid(req), req.body));
});

/** POST /products/lookup {name} | {gtin}: AI shelf life + price + allergens with cited sources. 10 requests/min per user. */
productsRouter.post("/products/lookup", perUser(10, 60_000, "lookup"), validate({ body: LookupBody }), async (req, res) => {
  res.json(await lookupService.lookup(uid(req), req.body));
});
