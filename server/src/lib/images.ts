import { logger } from "./logger.js";
import { s3 } from "./s3.js";

/**
 * Turns a stored S3 key into a URL the app can load: a presigned GET (1 hour) (backend/11 step 6).
 * Returns null when there is no key or S3 isn't configured, so responses still work without AWS.
 */
export const images = {
  async urlFor(key: string | null | undefined): Promise<string | null> {
    if (!key || !s3.isConfigured()) return null;
    try {
      return await s3.presignGet(key);
    } catch (err) {
      logger.warn({ err: String(err) }, "presign failed");
      return null;
    }
  },
};
