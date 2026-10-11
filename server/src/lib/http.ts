import { config } from "../config.js";
import { AppError } from "./errors.js";

export const USER_AGENT = () => `GrocerEZ/0.1 (+${config.CONTACT_EMAIL})`;

/**
 * Every outbound HTTP call goes through `http.fetch`, so tests can stub the network with
 * `vi.spyOn(http, "fetch")`. Production code never calls the global fetch directly.
 */
export const http = {
  fetch: (url: string, init?: RequestInit): Promise<Response> => fetch(url, init),
};

export class BlockedHostError extends AppError {
  constructor(host: string) {
    super(400, "HOST_NOT_ALLOWED", `Links to ${host} are not supported`);
  }
}

/**
 * GET a URL whose host (and every redirect hop's host) must pass `isAllowed`. Redirects are followed manually
 * (max 5), only over https, and a hop to any other host is refused, so a redirect can't be used for SSRF.
 */
export async function fetchAllowlisted(
  rawUrl: string,
  isAllowed: (host: string) => boolean,
  opts: { timeoutMs?: number; accept?: string } = {},
): Promise<{ finalUrl: string; body: string; status: number }> {
  let url = new URL(rawUrl);
  for (let hop = 0; hop <= 5; hop++) {
    if (url.protocol !== "https:") throw new BlockedHostError(url.host);
    if (!isAllowed(url.hostname) || url.username || url.password || (url.port && url.port !== "443")) {
      throw new BlockedHostError(url.hostname);
    }
    const res = await http.fetch(url.toString(), {
      redirect: "manual",
      headers: { "User-Agent": USER_AGENT(), Accept: opts.accept ?? "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new AppError(502, "UPSTREAM_ERROR", "Redirect without a location");
      url = new URL(loc, url);
      continue;
    }
    // Cap the body we read (2 MB) to keep a hostile page from exhausting memory.
    const text = await res.text();
    return { finalUrl: url.toString(), body: text.slice(0, 2_000_000), status: res.status };
  }
  throw new AppError(502, "UPSTREAM_ERROR", "Too many redirects");
}
