import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { logger } from "./lib/logger.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { healthRouter } from "./modules/health/router.js";
import { authRouter, devRouter } from "./modules/auth/router.js";
import { usersRouter } from "./modules/users/router.js";
import { groupsRouter } from "./modules/groups/router.js";
import { uploadsRouter } from "./modules/uploads/router.js";
import { itemsRouter } from "./modules/items/router.js";
import { preferencesRouter } from "./modules/preferences/router.js";
import { cabinetRouter } from "./modules/cabinet/router.js";
import { shoppingListRouter } from "./modules/shopping-list/router.js";
import { requireAuth } from "./middleware/auth.js";
import { requireGroupMember } from "./middleware/requireGroupMember.js";
import { config } from "./config.js";

// Expo web dev server. Native apps send no Origin header and are unaffected by CORS.
export const EXPO_DEV_ORIGINS = ["http://localhost:8081"];

export const app = express();
// Behind a host proxy, req.ip (used by the rate limiters) must come from X-Forwarded-For.
if (config.TRUST_PROXY) app.set("trust proxy", config.TRUST_PROXY);

app.use(helmet());
app.use(cors({ origin: EXPO_DEV_ORIGINS }));
app.use(express.json({ limit: "1mb" }));
app.use(pinoHttp({ logger }));

// Public routes.
app.use("/api", healthRouter);
app.use("/api", authRouter);
if (config.NODE_ENV !== "production") app.use("/api", devRouter);

// Everything below requires a valid app JWT (unknown /api paths included, so routes can't be probed).
app.use("/api", requireAuth);
// Every /groups/:groupId/* route, in any router, requires membership (backend/03).
app.use("/api/groups/:groupId", requireGroupMember);
app.use("/api", usersRouter);
app.use("/api", groupsRouter);
app.use("/api", uploadsRouter);
app.use("/api", itemsRouter);
app.use("/api", preferencesRouter);
app.use("/api", cabinetRouter);
app.use("/api", shoppingListRouter);

app.use(notFound);
app.use(errorHandler);
