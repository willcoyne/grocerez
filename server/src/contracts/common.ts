import { z } from "zod";

export const ErrorResponse = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export const HealthResponse = z.object({ ok: z.literal(true) });
export type HealthResponse = z.infer<typeof HealthResponse>;
