import type { Prisma } from "@prisma/client";
import { AppError } from "../../lib/errors.js";
import { emitGroup } from "../../lib/realtime.js";
import { itemsRepo } from "../items/repo.js";
import type { CreatePreferenceBody, Preference, UpdatePreferenceBody } from "../../contracts/preferences.js";
import { generate, inListTx } from "../shopping-list/service.js";
import { preferencesRepo } from "./repo.js";

// Every preference write regenerates the list in the same transaction (backend/06).
const changed = (groupId: string, userId: string) => {
  emitGroup(groupId, "preferences:changed", userId);
  emitGroup(groupId, "shopping-list:changed", userId);
};
const withList = <T>(groupId: string, write: (tx: Prisma.TransactionClient) => Promise<T>) =>
  inListTx(groupId, async (tx) => {
    const out = await write(tx);
    await generate(groupId, tx);
    return out;
  });

export const list = (groupId: string, userId: string, scope: "me" | "all") =>
  preferencesRepo.list(groupId, scope === "me" ? userId : null);

export async function upsert(groupId: string, userId: string, body: CreatePreferenceBody): Promise<Preference> {
  if (!(await itemsRepo.find(body.itemId))) throw new AppError(404, "ITEM_NOT_FOUND", "Item not found");
  const pref = await withList(groupId, (tx) => preferencesRepo.upsert(groupId, userId, body, tx));
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
  const pref = await withList(groupId, (tx) => preferencesRepo.update(groupId, id, body, tx));
  changed(groupId, userId);
  return pref;
}

export async function remove(groupId: string, id: string, userId: string) {
  await assertOwn(groupId, id, userId);
  await withList(groupId, (tx) => preferencesRepo.delete(groupId, id, tx));
  changed(groupId, userId);
}
