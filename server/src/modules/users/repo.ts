import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import type { GoogleIdentity } from "../../lib/google.js";
import type { UpdateMeBody, User } from "../../contracts/auth.js";
import type { Dietary } from "../../contracts/dietary.js";

const select = { id: true, email: true, displayName: true, avatarUrl: true, avatarKey: true, zipCode: true } as const;
// API User plus the stored S3 key; users/service toUser() turns the key into a presigned avatarUrl.
export type UserRow = User & { avatarKey: string | null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const usersRepo = {
  find: (id: string): Promise<UserRow | null> => prisma.user.findUnique({ where: { id }, select }),

  exists: async (id: string) => UUID.test(id) && (await prisma.user.count({ where: { id } })) > 0,

  // Keyed on google_sub, never email. Email follows Google on every login; name and picture
  // are only seeded on first login because the user can edit them (see DECISIONS.md).
  upsertFromGoogle: (g: GoogleIdentity): Promise<UserRow> => {
    const email = g.email.toLowerCase();
    return prisma.user.upsert({
      where: { googleSub: g.sub },
      create: { googleSub: g.sub, email, displayName: g.name?.trim() || email.split("@")[0], avatarUrl: g.picture ?? null },
      update: { email },
      select,
    });
  },

  update: (id: string, data: UpdateMeBody): Promise<UserRow> => prisma.user.update({ where: { id }, data, select }),

  delete: (id: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<UserRow> =>
    db.user.delete({ where: { id }, select }),

  dietary: async (userId: string): Promise<Dietary> => {
    const u = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { diets: { select: { diet: true }, orderBy: { diet: "asc" } }, allergens: { select: { allergen: true }, orderBy: { allergen: "asc" } } },
    });
    return { diets: u.diets.map((d) => d.diet as Dietary["diets"][number]), allergens: u.allergens.map((a) => a.allergen) };
  },

  // Replaces both sets in one transaction.
  setDietary: (userId: string, { diets, allergens }: Dietary) =>
    prisma.$transaction([
      prisma.userDiet.deleteMany({ where: { userId } }),
      prisma.userAllergen.deleteMany({ where: { userId } }),
      prisma.userDiet.createMany({ data: diets.map((diet) => ({ userId, diet })) }),
      prisma.userAllergen.createMany({ data: allergens.map((allergen) => ({ userId, allergen })) }),
    ]),
};
