import { pino } from "pino";
import { config } from "../config.js";

export const logger = pino({
  level: config.NODE_ENV === "test" ? "silent" : "info",
  redact: ["req.headers.authorization", "req.headers.cookie"],
});
