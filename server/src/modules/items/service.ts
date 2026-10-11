import { prisma, type Db } from "../../db.js";
import type { CreateItemBody, Item, ItemSearchResponse } from "../../contracts/items.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { normalize } from "../../lib/normalize.js";
import { itemsRepo, searchRowToItem, toItem } from "./repo.js";

const emptyName = () => badRequest("Item name is empty after normalization", "VALIDATION_ERROR");

export const itemsService = {
  /** GET /items/search: exact name/alias → "exact"; close trigram/levenshtein hit → "suggested"; else "none" + similar items. */
  async search(q: string, db: Db = prisma): Promise<ItemSearchResponse> {
    if (!normalize(q)) throw emptyName();
    const rows = await itemsRepo.search(db, q);
    if (rows.length === 0) return { match: "none", results: [] };
    return { match: rows[0].match, results: rows.map(searchRowToItem) };
  },

  /**
   * POST /items. With aliasOf: the user confirmed a suggestion → store normalize(name) as an alias and return that item.
   * Without: create the item (or return the existing one if the name/alias already exists).
   */
  async create(userId: string, body: CreateItemBody): Promise<{ item: Item; created: boolean }> {
    const n = normalize(body.name);
    if (!n) throw emptyName();
    return prisma.$transaction(async (tx) => {
      const existing = await itemsRepo.findExact(tx, n);
      if (body.aliasOf) {
        const target = await itemsRepo.findById(tx, body.aliasOf);
        if (!target) throw notFound("Item");
        if (existing) {
          if (existing.id === target.id) return { item: toItem(target), created: false };
          throw conflict(`"${body.name}" already means ${existing.name}`, "NAME_TAKEN");
        }
        const pointsTo = await itemsRepo.addAlias(tx, body.name, target.id);
        if (pointsTo !== target.id) throw conflict(`"${body.name}" already means another item`, "NAME_TAKEN");
        return { item: toItem(target), created: true };
      }
      if (existing) return { item: toItem(existing), created: false };
      const { item, created } = await itemsRepo.createOrGet(tx, body.name, body.category ?? "other", userId);
      return { item: toItem(item), created };
    });
  },

  /**
   * Shared "resolve free text to a catalog item" used by product scans (08) and recipe missing items (10):
   * exact or suggested → that item; otherwise create it (if createIfMissing).
   */
  async resolve(name: string, opts: { category?: string; createdBy?: string | null; createIfMissing?: boolean } = {}) {
    if (!normalize(name)) return null;
    const res = await this.search(name);
    if (res.match !== "none" && res.results[0]) return { item: res.results[0], match: res.match };
    if (!opts.createIfMissing) return null;
    const { item } = await itemsRepo.createOrGet(prisma, name.trim().slice(0, 200), opts.category ?? "other", opts.createdBy ?? null);
    return { item: toItem(item), match: "created" as const };
  },
};
