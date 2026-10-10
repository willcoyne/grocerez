# GrocerEZ web build in mock mode (no backend needed), served by nginx.
#   docker build -t grocerez-web:mock .
#   docker run --rm -p 8080:80 grocerez-web:mock   → http://localhost:8080
# Multi-arch for sharing:
#   docker buildx build --platform linux/amd64,linux/arm64 -t grocerez-web:mock --load .

# The web bundle is the same on every CPU, so build it once on the host's platform.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV EXPO_PUBLIC_USE_MOCK=1
RUN npx expo export --platform web --output-dir dist

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
