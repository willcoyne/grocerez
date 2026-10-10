import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import type { Item } from "../../contracts/items.js";
import type { AllergenFlag, ShoppingListItem } from "../../contracts/shoppingList.js";

type Db = Prisma.TransactionClient | typeof prisma;
type Tx = Prisma.TransactionClient;

const itemSelect = { id: true, name: true, category: true, defaultAllergens: true, shelfLifeDays: true } as const;
const person = { select: { id: true, displayName: true } } as const;
const select = {
  id: true,
  groupId: true,
  reason: true,
  wantedBy: true,
  quantityText: true,
  allergenFlags: true,
  checked: true,
  checkedAt: true,
  scannedProductId: true,
  createdAt: true,
  updatedAt: true,
  item: { select: itemSelect },
  checker: person,
  adder: person,
} as const;

// Store-aisle order (backend/06 step 2); uncategorized items go last with "other".
const AISLE = ["produce", "bakery", "meat", "seafood", "dairy", "frozen", "pantry", "snacks", "beverages", "household", "other"];
const aisle = (c: string | null) => AISLE.indexOf(c ?? "other");
const toPerson = (u: { id: string; displayName: string } | null) => (u ? { userId: u.id, displayName: u.displayName } : null);

// A row moved/deleted between our read and write (P2025) is reported as "not found".
const orNull = <T>(p: Promise<T>) =>
  p.catch((e) => {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") return null;
    throw e;
  });

// Every function is scoped by groupId.
export const listRepo = {
  // Mapped API rows, sorted by aisle then name.
  load: async (db: Db, groupId: string, id?: string): Promise<ShoppingListItem[]> => {
    const rows = await db.shoppingListItem.findMany({ where: { groupId, id }, select });
    const ids = [...new Set(rows.flatMap((r) => r.wantedBy))];
    const names = new Map(
      (await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } })).map((u) => [u.id, u]),
    );
    return rows
      .map(({ item, checker, adder, wantedBy, allergenFlags, checkedAt, createdAt, updatedAt, ...r }) => ({
        ...r,
        item: item as Item,
        wantedBy: wantedBy.flatMap((u) => (names.has(u) ? [toPerson(names.get(u)!)!] : [])),
        allergenFlags: allergenFlags as AllergenFlag[],
        checkedBy: toPerson(checker),
        checkedAt: checkedAt?.toISOString() ?? null,
        addedBy: toPerson(adder),
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
      }))
      .sort((a, b) => aisle(a.item.category) - aisle(b.item.category) || a.item.name.localeCompare(b.item.name));
  },

  // --- generate() inputs ---
  preferences: (tx: Tx, groupId: string) =>
    tx.preference.findMany({
      where: { groupId },
      select: { userId: true, itemId: true, quantityText: true },
      orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
    }),

  members: async (tx: Tx, groupId: string) =>
    (
      await tx.groupMember.findMany({
        where: { groupId },
        orderBy: [{ joinedAt: "asc" }, { userId: "asc" }],
        select: { user: { select: { id: true, displayName: true, allergens: { select: { allergen: true } } } } },
      })
    ).map(({ user }) => ({ id: user.id, displayName: user.displayName, allergens: user.allergens.map((a) => a.allergen) })),

  rows: (tx: Tx, groupId: string) =>
    tx.shoppingListItem.findMany({
      where: { groupId },
      select: {
        id: true,
        itemId: true,
        reason: true,
        checked: true,
        wantedBy: true,
        quantityText: true,
        allergenFlags: true,
        scannedProduct: { select: { allergens: true, mayContain: true } },
      },
    }),

  // Catalog allergens per item; generate() uses the scanned product's allergens ∪ may_contain instead when a row has one.
  itemAllergens: async (tx: Tx, itemIds: string[]) =>
    new Map(
      (await tx.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, defaultAllergens: true } })).map((i) => [
        i.id,
        i.defaultAllergens as string[],
      ]),
    ),

  // --- writes ---
  upsertManual: (tx: Tx, groupId: string, itemId: string, addedBy: string, quantityText: string | null | undefined) =>
    tx.shoppingListItem.upsert({
      where: { groupId_itemId: { groupId, itemId } },
      create: { groupId, itemId, reason: "manual", addedBy, quantityText },
      update: { reason: "manual", addedBy, quantityText },
      select: { id: true },
    }),

  update: (groupId: string, id: string, data: Prisma.ShoppingListItemUncheckedUpdateInput, db: Db = prisma) =>
    orNull(db.shoppingListItem.update({ where: { id, groupId }, data, select: { id: true } })),

  find: (tx: Tx, groupId: string, id: string) =>
    tx.shoppingListItem.findFirst({ where: { id, groupId }, select: { id: true, itemId: true, reason: true } }),

  // Locks the checked rows, so a concurrent un-check waits for finish trip and is re-evaluated after it.
  lockChecked: async (tx: Tx, groupId: string) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM shopping_list_items WHERE group_id = ${groupId}::uuid AND checked FOR UPDATE`;
    return tx.shoppingListItem.findMany({
      where: { groupId, id: { in: locked.map((r) => r.id) } },
      select: { id: true, itemId: true, scannedProductId: true, item: { select: itemSelect } },
    });
  },
};
