import { createServer } from "node:http";
import { app } from "./app.js";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { attachRealtime } from "./lib/realtime.js";
import { scheduleRecallImport } from "./jobs/importRecalls.js";

const server = createServer(app);
attachRealtime(server, config.CORS_ORIGINS);
void scheduleRecallImport(); // not in tests: they import app.ts, never index.ts

server.listen(config.PORT, () => logger.info(`GrocerEZ API listening on :${config.PORT}`));
