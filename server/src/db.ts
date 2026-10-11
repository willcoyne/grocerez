import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../generated/prisma/client.js";

/** PrismaClient singleton (Prisma 7 requires a driver adapter). */
export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/** An interactive-transaction client (what `prisma.$transaction(async (tx) => ...)` passes in). */
export type Tx = Prisma.TransactionClient;
/** Either the root client or a transaction client. */
export type Db = typeof prisma | Tx;
