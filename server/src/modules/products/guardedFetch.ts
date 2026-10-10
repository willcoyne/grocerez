import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { AppError } from "../../lib/errors.js";
import { FETCH_TIMEOUT_MS, USER_AGENT, upstreamError } from "./common.js";

// The one SSRF-safe outbound fetch (SmartLabel pages, Open Food Facts images): host allowlist, manual redirects with
// every hop re-checked, DNS answers must all be public, one timeout for the whole chain including the body read.

const MAX_REDIRECTS = 5;

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3],
] as const) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  // IPv4-mapped (::ffff:a.b.c.d) addresses are matched against the IPv4 rules by BlockList itself. The other forms
  // that embed an IPv4 (IPv4-compatible ::a.b.c.d, IPv4-translated ::ffff:0:a.b.c.d, NAT64, 6to4) are blocked whole.
  ["::", 96], ["::ffff:0:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["2002::", 16],
  ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(net, prefix, "ipv6");

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true; // not an IP at all: refuse
  return blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

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

export type LookupFn = (host: string) => Promise<{ address: string }[]>;
export interface FetchDeps {
  fetch?: typeof fetch;
  lookup?: LookupFn;
  timeoutMs?: number;
}

/**
 * Fetches `start` and hands the final 2xx response to `read`, still under the timeout. Anything else is
 * 502 UPSTREAM_ERROR; `label` prefixes the messages.
 * ponytail: DNS is checked here and resolved again by fetch (rebinding window). Low risk since only allowlisted
 * hostnames get this far; pin the IP with an undici dispatcher `connect.lookup` if that ever matters.
 */
export async function guardedFetch<T>(
  start: URL,
  allowHost: (host: string) => boolean,
  accept: string,
  read: (res: Response) => Promise<T>,
  deps: FetchDeps = {},
  label = "Upstream",
): Promise<{ url: URL; result: T }> {
  const doFetch = deps.fetch ?? fetch;
  const lookup = deps.lookup ?? ((host: string) => dnsLookup(host, { all: true }));
  const signal = AbortSignal.timeout(deps.timeoutMs ?? FETCH_TIMEOUT_MS);
  let url = start;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const addrs = await lookup(url.hostname).catch(() => {
        throw upstreamError(`${label} host did not resolve`);
      });
      if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) {
        throw upstreamError(`${label} host resolves to a private address`);
      }
      const res = await doFetch(url, { redirect: "manual", signal, headers: { "User-Agent": USER_AGENT, Accept: accept } });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel();
        const next = location ? checkUrl(location, allowHost, url) : null;
        if (!next) throw upstreamError(`${label} redirected to a disallowed URL`);
        url = next;
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw upstreamError(`${label} returned ${res.status}`);
      }
      return { url, result: await read(res) };
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw upstreamError(signal.aborted ? `${label} request timed out` : `${label} request failed`);
  }
  throw upstreamError("Too many redirects");
}
