# GrocerEZ API

Node 22+, TypeScript, Express 5, Prisma 6, Postgres 16 (Docker).

```sh
cd server
npm install                 # also runs prisma generate
cp .env.example .env        # then set JWT_SECRET (32+ chars); other secrets can stay placeholders locally
npm run db:up               # starts Postgres on :5432
npm run db:migrate          # applies prisma/migrations (run again after every pull)
npm run dev                 # http://localhost:3000/api/health -> {"ok":true}
npm test                    # vitest (needs db:up); `npx vitest run` for a single pass
```

The server refuses to start if any variable in `.env.example` is missing (except `RESEND_API_KEY`).
Tests use stub values from `vitest.config.ts` and never need real secrets.

Dev sign-in without Google: `POST /api/dev/login-as/:userId` returns `{token, user}` for an existing user
(not mounted when `NODE_ENV=production`).

Realtime: Socket.IO on the same port. Connect with `io(url, { auth: { token: appJwt } })`, then
`socket.emit("group:join", { groupId }, ack)`; see `src/lib/realtime.ts` for events and emit helpers.

## S3 setup (manual, once per environment)

Tests stub the presigners and never touch AWS. A real bucket is needed only to upload images from the app.

1. Create the bucket `grocerez-<team>-assets` with **Block Public Access ON** (all four settings) and no bucket policy
   granting public access. Objects are private; the API hands out presigned URLs (PUT: 5 min, GET: 1 h).
2. Create an IAM user (or role, for the deployed server) with only this policy, then put its keys in `.env`
   (`AWS_REGION`, `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": ["s3:PutObject", "s3:GetObject"],
       "Resource": "arn:aws:s3:::grocerez-<team>-assets/*"
     }]
   }
   ```

3. Bucket CORS (only needed for the Expo web build; native apps send no Origin). Add each deployed web origin:

   ```json
   [{
     "AllowedMethods": ["PUT", "GET"],
     "AllowedOrigins": ["http://localhost:8081"],
     "AllowedHeaders": ["content-type"],
     "MaxAgeSeconds": 3000
   }]
   ```

4. Check it isn't public: `curl -I https://grocerez-<team>-assets.s3.amazonaws.com/` and
   `curl -I https://grocerez-<team>-assets.s3.amazonaws.com/avatar/x.png` should both return `403`.

Upload flow: `POST /api/uploads/presign {contentType, purpose}`, then the app `PUT`s the file to `uploadUrl` with the
same `Content-Type` header (it's signed), then sends `key` to `PATCH /api/me {avatarKey}`. Responses return a presigned
GET URL in `avatarUrl`, never the key.
