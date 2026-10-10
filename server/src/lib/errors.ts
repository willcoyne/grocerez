/** An error with an HTTP status and a stable machine-readable code, rendered as {error:{code,message}}. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Resource", code = "NOT_FOUND") => new AppError(404, code, `${what} not found`);
export const forbidden = (message = "Not allowed") => new AppError(403, "FORBIDDEN", message);
export const badRequest = (message: string, code = "BAD_REQUEST") => new AppError(400, code, message);
export const conflict = (message: string, code = "CONFLICT") => new AppError(409, code, message);
export const notConfigured = (feature: string) =>
  new AppError(503, "NOT_CONFIGURED", `${feature} is not configured on this server`);
