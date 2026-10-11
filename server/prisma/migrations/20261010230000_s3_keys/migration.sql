-- backend/11: S3 keys for uploaded avatars and item photos (the app sends the key after a presigned PUT).
-- Keys look like "avatar/<userId>/<uuid>.jpg" / "item-photo/<userId>/<uuid>.png"; the API turns them into presigned GET URLs.
ALTER TABLE "users" ADD COLUMN "avatar_s3_key" TEXT;
ALTER TABLE "cabinet_items" ADD COLUMN "photo_s3_key" TEXT;

ALTER TABLE "users" ADD CONSTRAINT "users_avatar_s3_key_chk"
  CHECK ("avatar_s3_key" ~ '^avatar/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$');
ALTER TABLE "cabinet_items" ADD CONSTRAINT "cabinet_items_photo_s3_key_chk"
  CHECK ("photo_s3_key" ~ '^item-photo/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$');
