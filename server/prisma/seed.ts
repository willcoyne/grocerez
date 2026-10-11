// GrocerEZ seed. Idempotent: safe to run any number of times (`npm run db:seed`).
// Uses only Prisma's query builder and tagged-template $queryRaw / $executeRaw (never the *Unsafe variants).
import { readFileSync } from "node:fs";
import { prisma } from "../src/db.js";
import { DEFAULT_TIME_ZONE, householdToday } from "../src/lib/expiration.js";

type CatalogItem = {
  name: string;
  category: string;
  default_allergens: string[];
  shelf_life_days: number | null;
};

/** Upserts the global item catalog by normalized_name (computed by the SQL normalize_item_name()). */
async function seedCatalog() {
  const items: CatalogItem[] = JSON.parse(
    readFileSync(new URL("./seed/items.json", import.meta.url), "utf8"),
  );
  for (const it of items) {
    await prisma.$executeRaw`
      INSERT INTO items (name, normalized_name, category, default_allergens, shelf_life_days)
      VALUES (${it.name}, normalize_item_name(${it.name}), ${it.category},
              ${it.default_allergens}::allergen[], ${it.shelf_life_days})
      ON CONFLICT (normalized_name) DO UPDATE
        SET name = EXCLUDED.name,
            category = EXCLUDED.category,
            default_allergens = EXCLUDED.default_allergens,
            shelf_life_days = EXCLUDED.shelf_life_days`;
  }
  console.log(`catalog: ${items.length} items upserted`);
}

// ─── Demo state: the board's 4-user example ────────────────────────────────────
// Fixed IDs so the dev login route and the check query can refer to them.
export const DEMO_GROUP_ID = "00000000-0000-4000-8000-000000000001";
const DEMO_RECALL_EXTERNAL_ID = "DEMO-0001";
/** Pending invite for the live accept flow. SWAP FOR A TEAMMATE'S REAL GOOGLE EMAIL BEFORE THE DEMO (or set DEMO_INVITE_EMAIL). */
const DEMO_INVITE_EMAIL = (process.env.DEMO_INVITE_EMAIL ?? "teammate@example.com").trim().toLowerCase();

type Allergen = "milk" | "eggs" | "fish" | "shellfish" | "tree_nuts" | "peanuts" | "wheat" | "soy" | "sesame" | "gluten";
type DemoUser = {
  id: string;
  googleSub: string;
  email: string;
  displayName: string;
  allergens: Allergen[];
  /** [catalog item name, quantity text] */
  wants: [string, string | null][];
};

const DEMO_USERS: DemoUser[] = [
  { id: "00000000-0000-4000-8000-000000000101", googleSub: "seed-user-1", email: "seed-user-1@grocerez.test",
    displayName: "User 1", allergens: [], wants: [["Cheerios", null], ["Milk", "1 gal"], ["Peanut Butter", null]] },
  { id: "00000000-0000-4000-8000-000000000102", googleSub: "seed-user-2", email: "seed-user-2@grocerez.test",
    displayName: "User 2", allergens: [], wants: [["Tostitos", null], ["Cheerios", "2 boxes"], ["Bread", "1 loaf"]] },
  { id: "00000000-0000-4000-8000-000000000103", googleSub: "seed-user-3", email: "seed-user-3@grocerez.test",
    displayName: "User 3", allergens: ["milk"], wants: [["Lay's", null], ["Oreos", null]] },
  { id: "00000000-0000-4000-8000-000000000104", googleSub: "seed-user-4", email: "seed-user-4@grocerez.test",
    displayName: "User 4", allergens: ["peanuts"], wants: [["Oreos", "family size"], ["Lay's", null]] },
];

async function itemId(name: string): Promise<string> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM items WHERE normalized_name = normalize_item_name(${name})`;
  if (rows.length !== 1) throw new Error(`catalog item not found: ${name}`);
  return rows[0].id;
}

async function seedDemo() {
  const ids = new Map<string, string>();
  for (const name of ["Cheerios", "Tostitos", "Lay's", "Oreos", "Milk", "Peanut Butter", "Bread"]) {
    ids.set(name, await itemId(name));
  }
  const owner = DEMO_USERS[0];

  await prisma.$transaction(async (tx) => {
    // Users (upsert by google_sub) and their allergens (reset to the spec).
    for (const u of DEMO_USERS) {
      const user = await tx.user.upsert({
        where: { googleSub: u.googleSub },
        update: { email: u.email, displayName: u.displayName },
        create: { id: u.id, googleSub: u.googleSub, email: u.email, displayName: u.displayName },
      });
      u.id = user.id;
      await tx.userAllergen.deleteMany({ where: { userId: user.id } });
      await tx.userDiet.deleteMany({ where: { userId: user.id } });
      if (u.allergens.length) {
        await tx.userAllergen.createMany({ data: u.allergens.map((allergen) => ({ userId: user.id, allergen })) });
      }
    }

    // Group + members.
    await tx.group.upsert({
      where: { id: DEMO_GROUP_ID },
      update: { name: "Hack Midwest House" },
      create: { id: DEMO_GROUP_ID, name: "Hack Midwest House", createdBy: owner.id },
    });
    for (const [i, u] of DEMO_USERS.entries()) {
      const role = i === 0 ? "owner" : "member";
      await tx.groupMember.upsert({
        where: { groupId_userId: { groupId: DEMO_GROUP_ID, userId: u.id } },
        update: { role },
        create: { groupId: DEMO_GROUP_ID, userId: u.id, role },
      });
    }

    // Preferences: exactly the spec (all staples).
    await tx.preference.deleteMany({ where: { groupId: DEMO_GROUP_ID } });
    await tx.preference.createMany({
      data: DEMO_USERS.flatMap((u) =>
        u.wants.map(([name, quantityText]) => ({
          groupId: DEMO_GROUP_ID, userId: u.id, itemId: ids.get(name)!, quantityText, recurrence: "staple" as const,
        })),
      ),
    });

    // Cabinet: Cheerios in stock; Oreos running low and expiring in 2 days.
    await tx.cabinetItem.deleteMany({ where: { groupId: DEMO_GROUP_ID } });
    // Days in the household's time zone (groups.time_zone default), not the server's UTC day (DB-08).
    const inDays = (n: number) => householdToday(DEFAULT_TIME_ZONE, n);
    const cheerios = await tx.cabinetItem.create({
      data: { groupId: DEMO_GROUP_ID, itemId: ids.get("Cheerios")!, status: "in_stock", location: "pantry",
        quantityText: "1 box", purchasedAt: inDays(-3), expiresAt: inDays(177), expirationSource: "estimated", addedBy: owner.id },
    });
    await tx.cabinetItem.create({
      data: { groupId: DEMO_GROUP_ID, itemId: ids.get("Oreos")!, status: "running_low", location: "pantry",
        quantityText: "a few left", purchasedAt: inDays(-20), expiresAt: inDays(2), expirationSource: "manual", addedBy: DEMO_USERS[2].id },
    });

    // Offline recall that fuzzy-matches the cabinet's Cheerios.
    const recall = await tx.recall.upsert({
      where: { externalId: DEMO_RECALL_EXTERNAL_ID },
      update: {},
      create: {
        source: "demo", externalId: DEMO_RECALL_EXTERNAL_ID,
        productDescription: "Cheerios Toasted Whole Grain Oat Cereal, 18 oz box, UPC 016000275287",
        reason: "Demo recall: possible undeclared wheat (seeded for the offline alert demo, not a real recall).",
        classification: "Class II", firm: "Demo Foods Inc.", distribution: "Nationwide",
        reportDate: inDays(-1), status: "Ongoing",
      },
    });
    const [m] = await tx.$queryRaw<{ score: number }[]>`
      SELECT word_similarity(i.normalized_name, lower(r.product_description))::float8 AS score
      FROM recalls r, items i WHERE r.id = ${recall.id}::uuid AND i.id = ${cheerios.itemId}::uuid`;
    await tx.recallMatch.create({
      data: { recallId: recall.id, groupId: DEMO_GROUP_ID, cabinetItemId: cheerios.id, score: m.score },
    });

    // Pending invite from User 1.
    await tx.groupInvite.upsert({
      where: { groupId_email: { groupId: DEMO_GROUP_ID, email: DEMO_INVITE_EMAIL } },
      update: { status: "pending", respondedAt: null, invitedBy: owner.id },
      create: { groupId: DEMO_GROUP_ID, email: DEMO_INVITE_EMAIL, invitedBy: owner.id },
    });

    // Shopping list: start clean, then generate (preferences − cabinet).
    await tx.shoppingListItem.deleteMany({ where: { groupId: DEMO_GROUP_ID } });
    await tx.$queryRaw`SELECT generate_shopping_list(${DEMO_GROUP_ID}::uuid)`;
  });

  const list = await prisma.shoppingListItem.findMany({
    where: { groupId: DEMO_GROUP_ID }, include: { item: true }, orderBy: { item: { name: "asc" } },
  });
  console.log(`demo group "Hack Midwest House" (${DEMO_GROUP_ID})`);
  for (const u of DEMO_USERS) console.log(`  ${u.displayName}: ${u.id} (${u.googleSub})`);
  console.log(`  pending invite → ${DEMO_INVITE_EMAIL}`);
  console.log(`  shopping list: ${list.map((r) => r.item.name).join(", ")}`);
}

async function main() {
  await seedCatalog();
  await seedDemo();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
