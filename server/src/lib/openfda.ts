import { config } from "../config.js";
import { AppError } from "./errors.js";
import { http, USER_AGENT } from "./http.js";

export type FdaRecall = {
  recall_number: string;
  product_description: string;
  reason_for_recall?: string;
  classification?: string;
  recalling_firm?: string;
  distribution_pattern?: string;
  report_date?: string;
  status?: string;
  [k: string]: unknown;
};

/** "20260930" → Date (UTC midnight). */
export const fdaDate = (s: string | undefined): Date | null =>
  s && /^\d{8}$/.test(s) ? new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00.000Z`) : null;

export const toFdaDate = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

const PAGE = 100;
const MAX_SKIP = 25_000; // openFDA's limit for skip paging

export const openFda = {
  /**
   * All food enforcement reports with report_date in [since, until], paged with skip.
   * openFDA answers 404 NOT_FOUND when nothing matches (→ empty list).
   */
  async enforcementSince(since: Date, until: Date): Promise<FdaRecall[]> {
    const out: FdaRecall[] = [];
    for (let skip = 0; skip <= MAX_SKIP; skip += PAGE) {
      const params = new URLSearchParams({ limit: String(PAGE), skip: String(skip) });
      if (config.OPENFDA_API_KEY) params.set("api_key", config.OPENFDA_API_KEY);
      // The search value keeps its literal brackets and "+TO+" (openFDA syntax).
      const url = `https://api.fda.gov/food/enforcement.json?search=report_date:[${toFdaDate(since)}+TO+${toFdaDate(until)}]&${params}`;
      let res: Response;
      try {
        res = await http.fetch(url, { headers: { "User-Agent": USER_AGENT(), Accept: "application/json" }, signal: AbortSignal.timeout(20_000), redirect: "error" });
      } catch {
        throw new AppError(502, "UPSTREAM_UNAVAILABLE", "openFDA is unreachable");
      }
      if (res.status === 404) break;
      if (!res.ok) throw new AppError(502, "UPSTREAM_UNAVAILABLE", `openFDA responded ${res.status}`);
      const body = (await res.json()) as { meta?: { results?: { total?: number } }; results?: FdaRecall[] };
      const results = (body.results ?? []).filter((r) => r && typeof r.recall_number === "string" && typeof r.product_description === "string");
      out.push(...results);
      const total = body.meta?.results?.total ?? 0;
      if ((body.results ?? []).length < PAGE || skip + PAGE >= total) break;
    }
    return out;
  },
};
