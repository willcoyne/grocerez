import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import type { GoogleIdentity } from "../../lib/google.js";
import type { UpdateMeBody, User } from "../../contracts/auth.js";

const select = { id: true, email: true, displayName: true, avatarUrl: true, avatarKey: true, zipCode: true } as const;
// API User plus the stored S3 key; users/service toUser() turns the key into a presigned avatarUrl.
export type UserRow = User & { avatarKey: string | null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const usersRepo = {
  find: (id: string): Promise<UserRow | null> => prisma.user.findUnique({ where: { id }, select }),

  exists: async (id: string) => UUID.test(id) && (await prisma.user.count({ where: { id } })) > 0,

  // Keyed on google_sub, never email. Email follows Google on every login; name and picture
  // are only seeded on first login because the user can edit them (see DECISIONS.md).
  // Google has just verified that this sub owns the address, so a different row still holding it is stale (Workspace
  // address reassigned, or the old owner changed their Google email). That row's email is parked at a unique
  // `stale+<id>@invalid` address in the same transaction; it is refreshed if its owner signs in again.
  upsertFromGoogle: (g: GoogleIdentity): Promise<UserRow> => {
    const email = g.email.toLowerCase();
    const name = g.name?.trim();
    return prisma.$transaction(async (tx) => {
      const stale = await tx.user.findFirst({ where: { email, NOT: { googleSub: g.sub } }, select: { id: true } });
      if (stale) await tx.user.update({ where: { id: stale.id }, data: { email: `stale+${stale.id}@invalid` } });
      return tx.user.upsert({
        where: { googleSub: g.sub },
        create: {
          googleSub: g.sub,
          email,
          displayName: name && /[^\p{Cf}\p{Z}\s]/u.test(name) ? name : email.split("@")[0],
          avatarUrl: g.picture ?? null,
        },
        update: { email },
        select,
      });
    });
  },

  // Seeded demo accounts (database/10) have fake google_sub values prefixed `seed-`.
  findSeeded: (id: string): Promise<UserRow | null> =>
    prisma.user.findFirst({ where: { id, googleSub: { startsWith: "seed-" } }, select }),

  update: (id: string, data: UpdateMeBody): Promise<UserRow> => prisma.user.update({ where: { id }, data, select }),

  delete: (id: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<UserRow> =>
    db.user.delete({ where: { id }, select }),
};
