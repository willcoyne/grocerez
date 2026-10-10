# GrocerEZ API

Node 22+, TypeScript, Express 5, Prisma 6, Postgres 16 (Docker).

```sh
cd server
npm install                 # also runs prisma generate
cp .env.example .env        # then set JWT_SECRET (32+ chars); other secrets can stay placeholders locally
npm run db:up               # starts Postgres on :5432
npm run dev                 # http://localhost:3000/api/health -> {"ok":true}
npm test                    # vitest (needs db:up); `npx vitest run` for a single pass
```

The server refuses to start if any variable in `.env.example` is missing (except `RESEND_API_KEY`).
Tests use stub values from `vitest.config.ts` and never need real secrets.
