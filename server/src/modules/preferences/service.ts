import { AppError } from "../../lib/errors.js";
import { emitGroup } from "../../lib/realtime.js";
import { itemsRepo } from "../items/repo.js";
import type { CreatePreferenceBody, Preference, UpdatePreferenceBody } from "../../contracts/preferences.js";
import { preferencesRepo } from "./repo.js";

// ponytail: backend/06 adds `await generate(groupId)` to changed() once the shopping list engine exists.
const changed = (groupId: string, userId: string) => emitGroup(groupId, "preferences:changed", userId);

export const list = (groupId: string, userId: string, scope: "me" | "all") =>
  preferencesRepo.list(groupId, scope === "me" ? userId : null);

export async function upsert(groupId: string, userId: string, body: CreatePreferenceBody): Promise<Preference> {
  if (!(await itemsRepo.find(body.itemId))) throw new AppError(404, "ITEM_NOT_FOUND", "Item not found");
  const pref = await preferencesRepo.upsert(groupId, userId, body);
  changed(groupId, userId);
  return pref;
}

// Own rows only: someone else's row in this group is 403, a row not in this group is 404.
async function assertOwn(groupId: string, id: string, userId: string) {
  const owner = await preferencesRepo.owner(groupId, id);
  if (!owner) throw new AppError(404, "PREFERENCE_NOT_FOUND", "Preference not found");
  if (owner !== userId) throw new AppError(403, "FORBIDDEN", "You can only change your own preferences");
}

export async function update(groupId: string, id: string, userId: string, body: UpdatePreferenceBody): Promise<Preference> {
  await assertOwn(groupId, id, userId);
  const pref = await preferencesRepo.update(groupId, id, body);
  changed(groupId, userId);
  return pref;
}

export async function remove(groupId: string, id: string, userId: string) {
  await assertOwn(groupId, id, userId);
  await preferencesRepo.delete(groupId, id);
  changed(groupId, userId);
}
