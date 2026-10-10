import type { Db } from "../../db.js";
import type { Prisma } from "../../../generated/prisma/client.js";

export const productInclude = { item: { select: { id: true, name: true, category: true } } } as const;

/** Products are a global cache (not group data): keyed by GTIN-14 or the canonical SmartLabel URL. */
export const productsRepo = {
  findByGtin: (db: Db, gtin: string) => db.product.findUnique({ where: { gtin }, include: productInclude }),
  findByUrl: (db: Db, smartlabelUrl: string) => db.product.findUnique({ where: { smartlabelUrl }, include: productInclude }),
  findById: (db: Db, id: string) => db.product.findUnique({ where: { id }, include: productInclude }),

  create: (db: Db, data: Prisma.ProductUncheckedCreateInput) => db.product.create({ data, include: productInclude }),
  update: (db: Db, id: string, data: Prisma.ProductUncheckedUpdateInput) =>
    db.product.update({ where: { id }, data, include: productInclude }),
};
