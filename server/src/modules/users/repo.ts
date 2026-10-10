import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import type { GoogleIdentity } from "../../lib/google.js";
import type { UpdateMeBody, User } from "../../contracts/auth.js";

const select = { id: true, email: true, displayName: true, avatarUrl: true, zipCode: true } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const usersRepo = {
  find: (id: string): Promise<User | null> => prisma.user.findUnique({ where: { id }, select }),

  exists: async (id: string) => UUID.test(id) && (await prisma.user.count({ where: { id } })) > 0,

  // Keyed on google_sub, never email. Email follows Google on every login; name and picture
  // are only seeded on first login because the user can edit them (see DECISIONS.md).
  upsertFromGoogle: (g: GoogleIdentity): Promise<User> => {
    const email = g.email.toLowerCase();
    return prisma.user.upsert({
      where: { googleSub: g.sub },
      create: { googleSub: g.sub, email, displayName: g.name?.trim() || email.split("@")[0], avatarUrl: g.picture ?? null },
      update: { email },
      select,
    });
  },

  update: (id: string, data: UpdateMeBody): Promise<User> => prisma.user.update({ where: { id }, data, select }),

  delete: (id: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<User> =>
    db.user.delete({ where: { id }, select }),
};
