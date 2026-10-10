// GrocerEZ seed. Idempotent: safe to run any number of times (`npm run db:seed`).
// Uses only Prisma's query builder and tagged-template $queryRaw / $executeRaw (never the *Unsafe variants).
import { readFileSync } from "node:fs";
import { prisma } from "../src/db.js";

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

async function main() {
  await seedCatalog();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
