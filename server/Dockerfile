# GrocerEZ API (backend/12 step 1). Build from server/:  docker build -t grocerez-api .
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# prisma.config.ts reads DATABASE_URL; generate doesn't connect, so a placeholder is enough at build time.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate && npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# node_modules keeps dev dependencies on purpose: the prisma CLI (migrate deploy at start) and tsx (prisma db seed) are dev deps.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/generated ./generated
COPY package.json prisma.config.ts tsconfig.json ./
COPY prisma ./prisma
# The seed (tsx prisma/seed.ts) imports TypeScript from src/, so keep the sources for `prisma db seed`.
COPY src ./src
EXPOSE 3000
USER node
# MIGRATE_DATABASE_URL (owner) is used by migrate deploy when set; DATABASE_URL (grocerez_app) by the API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/index.js"]
