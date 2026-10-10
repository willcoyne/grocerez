import cron from "node-cron";
import { logger } from "../lib/logger.js";
import { recallsService } from "../modules/recalls/service.js";

/** Daily openFDA recall import + matching at 06:00 server time (backend/09). Keep the service at 1 instance. */
export function scheduleRecallImport() {
  return cron.schedule("0 6 * * *", async () => {
    try {
      await recallsService.importAndMatch();
    } catch (err) {
      logger.error({ err }, "recall import failed");
    }
  });
}
