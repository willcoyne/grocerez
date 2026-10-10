-- backend/11: S3 key of an uploaded avatar ("avatar/<userId>/<uuid>.<ext>"). When set, the API returns a
-- presigned GET URL for it as avatarUrl instead of avatar_url (the Google picture).
ALTER TABLE "users" ADD COLUMN "avatar_s3_key" TEXT;
