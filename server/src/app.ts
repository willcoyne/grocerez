import cors from "cors";
import express, { Router } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { requireAuth } from "./middleware/auth.js";
import { requireGroupMember } from "./middleware/requireGroupMember.js";
import { agentInternalRouter } from "./modules/agent/internal.js";
import { agentRouter } from "./modules/agent/router.js";
import { aiRouter } from "./modules/ai/router.js";
import { cabinetRouter } from "./modules/cabinet/router.js";
import { dietaryRouter } from "./modules/dietary/router.js";
import { groupScopedRouter, groupsRouter } from "./modules/groups/router.js";
import { itemsRouter } from "./modules/items/router.js";
import { mealPlanRouter } from "./modules/meal-plan/router.js";
import { preferencesRouter } from "./modules/preferences/router.js";
import { productsRouter } from "./modules/products/router.js";
import { healthRouter } from "./modules/health/router.js";
import { alertsRouter } from "./modules/recalls/router.js";
import { shoppingListRouter } from "./modules/shopping-list/router.js";
import { uploadsRouter } from "./modules/uploads/router.js";
import { authRouter, devRouter, meRouter } from "./modules/users/router.js";

/** Builds the Express app (no network listener; index.ts adds the HTTP server and Socket.IO). */
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(
    cors({
      // Native apps send no Origin header; browsers (Expo web) must be on the allow-list.
      origin: (origin, cb) => cb(null, !origin || config.CORS_ORIGINS.includes(origin) || config.NODE_ENV !== "production"),
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(
    pinoHttp({
      logger,
      serializers: {
        req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  const api = Router();
  // Public routes.
  api.use(healthRouter);
  api.use(authRouter);
  api.use(devRouter());
  // Pantry Agent → server events: authenticated by X-Agent-Secret, not an app JWT.
  api.use(agentInternalRouter);
  // Everything below needs a valid app JWT.
  api.use(requireAuth);
  api.use(meRouter);
  api.use(dietaryRouter);
  api.use(groupsRouter);
  api.use(itemsRouter);
  api.use(productsRouter);
  api.use(uploadsRouter);

  // /groups/:groupId/* : membership is checked once here for every group-scoped feature router.
  const group = Router({ mergeParams: true });
  group.use(groupScopedRouter);
  group.use(preferencesRouter);
  group.use(cabinetRouter);
  group.use(aiRouter);
  group.use(agentRouter);
  group.use(mealPlanRouter);
  group.use(shoppingListRouter);
  group.use(alertsRouter);
  api.use("/groups/:groupId", requireGroupMember, group);

  app.use("/api", api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
