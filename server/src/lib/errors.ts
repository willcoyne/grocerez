import { Prisma } from "@prisma/client";

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// A row deleted/moved between our read and write (Prisma P2025) is reported as "not found" (null).
export const orNull = <T>(p: Promise<T>) =>
  p.catch((e) => {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") return null;
    throw e;
  });
