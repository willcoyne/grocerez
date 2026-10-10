import { createServer } from "node:http";
import { app } from "./app.js";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";

// Socket.IO is attached in backend/07, cron jobs start in backend/09.
const server = createServer(app);

server.listen(config.PORT, () => logger.info(`GrocerEZ API listening on :${config.PORT}`));
