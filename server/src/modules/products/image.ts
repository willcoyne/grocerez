import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "../../lib/errors.js";
import { FETCH_TIMEOUT_MS, USER_AGENT, upstreamError } from "./common.js";
import { isPrivateAddress, type FetchDeps } from "./smartlabel.js";

const MAX_REDIRECTS = 5;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** https, no credentials, default port, a hostname (not an IP literal) that `allowHost` accepts. Null otherwise. */
export function checkUrl(raw: string, allowHost: (host: string) => boolean, base?: URL): URL | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port !== "") return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isIP(host.replace(/^\[|\]$/g, "")) || !allowHost(host)) return null;
  return url;
}

/**
 * Same guard as fetchSmartLabelPage, for any host allowlist: every redirect hop is re-checked against the allowlist and
 * must resolve only to public addresses. Returns the final 2xx response; anything else is 502 UPSTREAM_ERROR.
 * ponytail: duplicates the loop in smartlabel.ts (kept untouched while its parser is being fixed elsewhere); point
 * fetchSmartLabelPage at this after that merges.
 */
export async function guardedFetch(
  start: URL,
  allowHost: (host: string) => boolean,
  accept: string,
  deps: FetchDeps = {},
): Promise<Response> {
  const doFetch = deps.fetch ?? fetch;
  const lookup = deps.lookup ?? ((host: string) => dnsLookup(host, { all: true }));
  const signal = AbortSignal.timeout(deps.timeoutMs ?? FETCH_TIMEOUT_MS);
  let url = start;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const addrs = await lookup(url.hostname).catch(() => {
        throw upstreamError("Host did not resolve");
      });
      if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) {
        throw upstreamError("Host resolves to a private address");
      }
      const res = await doFetch(url, { redirect: "manual", signal, headers: { "User-Agent": USER_AGENT, Accept: accept } });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel();
        const next = location ? checkUrl(location, allowHost, url) : null;
        if (!next) throw upstreamError("Redirected to a disallowed URL");
        url = next;
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw upstreamError(`Upstream returned ${res.status}`);
      }
      return res;
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw upstreamError(signal.aborted ? "Upstream timed out" : "Upstream request failed");
  }
  throw upstreamError("Too many redirects");
}

// Open Food Facts serves product photos from images.openfoodfacts.org (older URLs: static.openfoodfacts.org).
const offImageHost = (h: string) => h === "openfoodfacts.org" || h.endsWith(".openfoodfacts.org");

/** Downloads a product photo (Open Food Facts hosts only, jpeg/png/webp, 5 MB cap). */
export async function fetchProductImage(
  rawUrl: string,
  deps: FetchDeps = {},
): Promise<{ body: Uint8Array; contentType: string }> {
  const url = checkUrl(rawUrl, offImageHost);
  if (!url) throw upstreamError("Image URL is not an allowed Open Food Facts URL");
  const res = await guardedFetch(url, offImageHost, IMAGE_TYPES.join(","), deps);
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
