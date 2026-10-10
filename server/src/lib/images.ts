/**
 * Turns a stored S3 key into a URL the app can load (backend/11 step 6). Until S3 is wired up (11),
 * keys can't be served, so this returns null. Replaced by a presigned GET in lib/s3.ts.
 */
export const images = {
  async urlFor(key: string | null | undefined): Promise<string | null> {
    if (!key) return null;
    if (/^https?:\/\//.test(key)) return key;
    return null;
  },
};
