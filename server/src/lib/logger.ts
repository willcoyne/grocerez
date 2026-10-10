import { pino } from "pino";
import { config } from "../config.js";

/** JSON logger. Never log tokens, emails or request bodies (database/11 step 5). */
export const logger = pino({
  level: config.NODE_ENV === "test" ? "silent" : (process.env.LOG_LEVEL ?? "info"),
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "*.email", "*.idToken", "*.token"],
    censor: "[redacted]",
  },
});
