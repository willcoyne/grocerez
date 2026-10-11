import "express";

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth. */
      userId?: string;
      /** Set by requireGroupMember. */
      membership?: { groupId: string; role: "owner" | "member" };
    }
  }
}
