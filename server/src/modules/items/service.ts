import { AppError } from "../../lib/errors.js";
import { normalizeItemName } from "../../lib/normalize.js";
import type { CreateItemBody, Item, ItemSearchResponse } from "../../contracts/items.js";
import { itemsRepo } from "./repo.js";

function normalizeOr400(name: string) {
  const q = normalizeItemName(name);
  if (!q) throw new AppError(400, "VALIDATION_ERROR", "Name has no letters or numbers");
  return q;
}

// "Did you mean" threshold: Levenshtein distance from the typed (normalized) text.
const maxDistance = (q: string) => ([...q].length < 5 ? 1 : 2);

export async function search(input: string): Promise<ItemSearchResponse> {
  const q = normalizeOr400(input);
  const exact = await itemsRepo.findExact(q);
  if (exact) return { match: "exact", results: [exact] };

  const candidates = await itemsRepo.fuzzy(q);
  const results = candidates.map(({ distance: _, ...item }) => item);
  return { match: candidates[0] && candidates[0].distance <= maxDistance(q) ? "suggested" : "none", results };
}

export async function create(body: CreateItemBody, userId: string): Promise<Item> {
  const normalized = normalizeOr400(body.name);

  if (body.aliasOf) {
    const target = await itemsRepo.find(body.aliasOf);
    if (!target) throw new AppError(404, "ITEM_NOT_FOUND", "Item not found");
    // Text that already resolves exactly (to this or another item) needs no alias.
    if (await itemsRepo.findExact(normalized)) return target;
    // Aliases are global and permanent, so only an item search would suggest for this text can be confirmed.
    const suggested = (await itemsRepo.fuzzy(normalized)).some((c) => c.id === target.id && c.distance <= maxDistance(normalized));
    if (!suggested) throw new AppError(400, "ALIAS_NOT_SUGGESTED", "aliasOf must be an item suggested for this name");
    await itemsRepo.addAlias(target.id, normalized);
    return target;
  }

  return (await itemsRepo.findExact(normalized)) ?? itemsRepo.create(body.name, normalized, body.category, userId);
}
