# GrocerEZ API. Build from server/: docker build -t grocerez-api .
FROM node:22-slim AS base
# Prisma's query engine needs OpenSSL; slim images don't ship it.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx prisma generate && npm run build

FROM base AS runtime
ENV NODE_ENV=production
# ponytail: copies dev deps too, because the prisma CLI (a devDependency) runs `migrate deploy` at start.
# Move prisma to dependencies and `npm prune --omit=dev` if image size matters.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY prisma ./prisma
USER node
EXPOSE 3000
# Migrations run on every start: `migrate deploy` is idempotent and the service runs as 1 instance (backend/12 step 3).
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/index.js"]
