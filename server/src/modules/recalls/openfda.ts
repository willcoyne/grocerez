import { z } from "zod";
import { logger } from "../../lib/logger.js";
import { CONTROL_CHARS } from "../../middleware/validate.js";

// openFDA food enforcement client. `fetch` is injectable so tests never hit the network.
const BASE = "https://api.fda.gov/food/enforcement.json";
const PAGE = 100;
const MAX_SKIP = 25000; // openFDA rejects skip above this

const toIso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
/** A real calendar day ("20261399" and "20260230" pass /^\d{8}$/ but are Invalid Date or roll over). */
const isRealDay = (d: string) => {
  const t = new Date(`${toIso(d)}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === toIso(d);
};

// Postgres rejects NUL in text and jsonb; one bad row used to fail the whole batch. Strip controls from every string.
const CONTROL = new RegExp(CONTROL_CHARS, "g");
const stripControls = (v: unknown): unknown =>
  typeof v === "string"
    ? v.replace(CONTROL, "")
    : Array.isArray(v)
      ? v.map(stripControls)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k.replace(CONTROL, ""), stripControls(x)]))
        : v;

const Result = z.looseObject({
  recall_number: z.string().min(1),
  product_description: z.string().min(1),
  reason_for_recall: z.string().optional(),
  classification: z.string().optional(),
  recalling_firm: z.string().optional(),
  distribution_pattern: z.string().optional(),
  report_date: z.string().regex(/^\d{8}$/).refine(isRealDay).optional(),
  status: z.string().optional(),
});

const Page = z.object({
  meta: z.object({ results: z.object({ total: z.number() }) }),
  results: z.array(z.unknown()),
});

export type Recall = {
  source: "openfda";
  externalId: string;
  productDescription: string;
  reason: string | null;
  classification: string | null;
  firm: string | null;
  distribution: string | null;
  reportDate: Date | null;
  status: string | null;
  raw: Record<string, unknown>;
};

const ymd = (d: Date) => d.toISOString().slice(0, 10).replaceAll("-", "");

/** Link shown in alerts. openFDA has no per-recall page, so this is the API query for that recall number. */
export function recallLink(externalId: string): string {
  return `${BASE}?search=recall_number:"${encodeURIComponent(externalId)}"`;
}

export function mapRecall(r: z.infer<typeof Result>): Recall {
  const d = r.report_date;
  return {
    source: "openfda",
    externalId: r.recall_number,
    productDescription: r.product_description,
    reason: r.reason_for_recall ?? null,
    classification: r.classification ?? null,
    firm: r.recalling_firm ?? null,
    distribution: r.distribution_pattern ?? null,
    reportDate: d ? new Date(`${toIso(d)}T00:00:00Z`) : null,
    status: r.status ?? null,
    raw: r,
  };
}

/** All recalls reported between `since` and `until` (inclusive), paging with `skip`. Malformed rows are skipped. */
export async function fetchRecalls(opts: {
  since: Date;
  until: Date;
  apiKey?: string;
  fetch?: typeof fetch;
}): Promise<Recall[]> {
  const doFetch = opts.fetch ?? fetch;
  const out: Recall[] = [];
  let skipped = 0;
  for (let skip = 0; skip <= MAX_SKIP; skip += PAGE) {
    // openFDA wants a literal '+' around TO, so the search value is not URL-encoded.
    let url = `${BASE}?search=report_date:[${ymd(opts.since)}+TO+${ymd(opts.until)}]&limit=${PAGE}&skip=${skip}`;
    if (opts.apiKey) url += `&api_key=${encodeURIComponent(opts.apiKey)}`;
    const res = await doFetch(url, { redirect: "error", signal: AbortSignal.timeout(15000) });
    if (res.status === 404) break; // openFDA answers "no matches" with 404 NOT_FOUND
    if (!res.ok) throw new Error(`openFDA ${res.status}`);
    const page = Page.parse(await res.json());
    for (const row of page.results) {
      const parsed = Result.safeParse(stripControls(row));
      if (parsed.success) out.push(mapRecall(parsed.data));
      else skipped++;
    }
    if (page.results.length < PAGE || skip + PAGE >= page.meta.results.total) break;
  }
  if (skipped) logger.warn({ skipped }, "openFDA rows skipped (malformed)");
  return out;
}
