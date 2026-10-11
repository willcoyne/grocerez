import { createServer } from "node:http";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { logger } from "./lib/logger.js";
import { scheduleRecallImport } from "./jobs/importRecalls.js";
import { createSocketServer } from "./realtime/socket.js";

const app = createApp();
const httpServer = createServer(app);
const io = createSocketServer(httpServer);
const jobs = config.ENABLE_JOBS ? [scheduleRecallImport()] : [];

httpServer.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, "GrocerEZ API listening");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  for (const j of jobs) j.stop();
  io.close();
  httpServer.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
