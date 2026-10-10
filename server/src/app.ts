import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { logger } from "./lib/logger.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { healthRouter } from "./modules/health/router.js";

// Expo web dev server. Native apps send no Origin header and are unaffected by CORS.
const EXPO_DEV_ORIGINS = ["http://localhost:8081"];

export const app = express();

app.use(helmet());
app.use(cors({ origin: EXPO_DEV_ORIGINS }));
app.use(express.json({ limit: "1mb" }));
app.use(pinoHttp({ logger }));

app.use("/api", healthRouter);

app.use(notFound);
app.use(errorHandler);
