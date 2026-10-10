import { upstreamError } from "./common.js";
import { checkUrl, guardedFetch, type FetchDeps } from "./guardedFetch.js";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Open Food Facts serves product photos from images.openfoodfacts.org (older URLs: static.openfoodfacts.org).
const offImageHost = (h: string) => h === "openfoodfacts.org" || h.endsWith(".openfoodfacts.org");

/** Downloads a product photo (Open Food Facts hosts only, jpeg/png/webp, 5 MB cap). */
export async function fetchProductImage(
  rawUrl: string,
  deps: FetchDeps = {},
): Promise<{ body: Uint8Array; contentType: string }> {
  const url = checkUrl(rawUrl, offImageHost);
  if (!url) throw upstreamError("Image URL is not an allowed Open Food Facts URL");
  const { result } = await guardedFetch(url, offImageHost, IMAGE_TYPES.join(","), readImage, deps, "Image");
  return result;
}

async function readImage(res: Response): Promise<{ body: Uint8Array; contentType: string }> {
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!IMAGE_TYPES.includes(contentType)) {
    await res.body?.cancel();
    throw upstreamError("Not an image");
  }
  if (Number(res.headers.get("content-length")) > MAX_IMAGE_BYTES) {
    await res.body?.cancel();
    throw upstreamError("Image too large");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (res.body) {
    for await (const chunk of res.body) {
      size += chunk.byteLength;
      if (size > MAX_IMAGE_BYTES) throw upstreamError("Image too large");
      chunks.push(chunk);
    }
  }
  return { body: Buffer.concat(chunks), contentType };
}
