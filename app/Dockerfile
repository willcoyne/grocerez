# GrocerEZ web app (Expo web export served by nginx), talking to the real API.
# Build from the REPO ROOT, because the app imports the server's zod contracts (server/src/contracts):
#   docker build -f app/Dockerfile -t grocerez-web --build-arg EXPO_PUBLIC_API_URL=http://localhost:3100/api .
# Usually run through the root docker-compose.yml instead.

# The web bundle is the same on every CPU, so build it once on the host's platform.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /build/app
COPY app/package.json app/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY server/src/contracts /build/server/src/contracts
COPY app/ ./
# EXPO_PUBLIC_* values are inlined into the bundle at build time.
ARG EXPO_PUBLIC_API_URL=http://localhost:3100/api
ARG EXPO_PUBLIC_DEMO_KEY=
ARG EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL \
    EXPO_PUBLIC_DEMO_KEY=$EXPO_PUBLIC_DEMO_KEY \
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=$EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
RUN npx expo export --platform web --output-dir dist

FROM nginx:1.27-alpine
COPY app/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/app/dist /usr/share/nginx/html
EXPOSE 80
