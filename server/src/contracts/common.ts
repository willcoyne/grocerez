import { z } from "zod";

export const ErrorResponse = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

// A name people see in lists (display names, group names). Must have at least one visible character: .trim() leaves
// zero-width and bidi-control (format, \p{Cf}) characters, so a name of only those would render blank or spoofed.
// They're rejected only when nothing else is there, so emoji ZWJ sequences still work.
export const visibleName = (max: number) =>
  z.string().trim().min(1).max(max).refine((s) => /[^\p{Cf}\p{Z}\s]/u.test(s), "must contain visible characters");

export const HealthResponse = z.object({ ok: z.literal(true) });
export type HealthResponse = z.infer<typeof HealthResponse>;
