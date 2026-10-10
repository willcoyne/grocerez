# 11 — File Storage (S3)

**Goal:** Store images (product photos, item photos, avatars) in S3 without routing file bytes through the API.
**Board:** "Postgres + s3 bucket for backend" (the board doesn't say what the bucket is for; see `GAPS.md` #3)

**Depends on:** 01, 02

## Steps

1. **AWS setup:** create the bucket `grocerez-<team>-assets` (private, Block Public Access ON). Create an IAM user/role
   whose policy only allows `s3:PutObject` and `s3:GetObject` on `arn:aws:s3:::grocerez-<team>-assets/*`.
   Credentials go in `.env`.
2. Bucket CORS: allow `PUT` and `GET` from the app origins (only needed for the Expo web build).
3. `lib/s3.ts`: an `S3Client` + `presignPut(key, contentType)` (5-minute expiry) and `presignGet(key)` (1-hour expiry).
4. `POST /uploads/presign {contentType, purpose: "avatar"|"item-photo"}`:
   - Only allow `image/jpeg`, `image/png`, and `image/webp`.
   - Key: `${purpose}/${userId}/${uuid}.${ext}`. Return `{uploadUrl, key}`. The app `PUT`s the file directly to S3,
     then sends `key` to the relevant endpoint (`PATCH /me {avatarKey}` or `PATCH cabinet {photoKey}`).
5. Product images from Open Food Facts (`08`): download on the server and `PutObject` under `products/{productId}.jpg`
   (so we don't depend on hotlinking).
6. Whenever an API response includes an image, swap each stored `*_s3_key` for a presigned GET URL.
7. *(Option)* If the team would rather stay entirely on Google Cloud, Google Cloud Storage works the same way with its own presigned URLs.

## Done when

- [ ] An avatar upload goes app → S3 directly and shows in the group member list
- [ ] The bucket isn't publicly listable or readable
