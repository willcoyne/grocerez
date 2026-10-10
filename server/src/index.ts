import { createServer } from "node:http";
import { app, EXPO_DEV_ORIGINS } from "./app.js";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { attachRealtime } from "./lib/realtime.js";

// Cron jobs start in backend/09.
const server = createServer(app);
attachRealtime(server, EXPO_DEV_ORIGINS);

server.listen(config.PORT, () => logger.info(`GrocerEZ API listening on :${config.PORT}`));
