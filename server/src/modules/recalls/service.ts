import type { Alerts } from "../../contracts/alerts.js";
import type { Item } from "../../contracts/items.js";
import { AppError } from "../../lib/errors.js";
import { emitGroup } from "../../lib/realtime.js";
import { cabinetRepo } from "../cabinet/repo.js";
import { toCabinetItem } from "../cabinet/service.js";
import { recallLink } from "./openfda.js";
import { recallsRepo } from "./repo.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRING_DAYS = 3;

// expiring: expires_at within 3 days, already expired included, soonest first. Dates are UTC calendar days.
export async function alerts(groupId: string): Promise<Alerts> {
  const until = new Date(`${new Date(Date.now() + EXPIRING_DAYS * DAY_MS).toISOString().slice(0, 10)}T00:00:00Z`);
  const [expiring, matches] = await Promise.all([cabinetRepo.expiring(groupId, until), recallsRepo.openMatches(groupId)]);
  return {
    expiring: await Promise.all(expiring.map(toCabinetItem)),
    recalls: matches.map(({ recall: r, cabinetItem, createdAt, ...m }) => ({
      ...m,
      item: cabinetItem.item as Item,
      createdAt: createdAt.toISOString(),
      recall: {
        externalId: r.externalId,
        productDescription: r.productDescription,
        reason: r.reason,
        classification: r.classification,
        firm: r.firm,
        distribution: r.distribution,
        reportDate: r.reportDate?.toISOString().slice(0, 10) ?? null,
        status: r.status,
        link: recallLink(r.externalId),
      },
    })),
  };
}

export async function dismiss(groupId: string, matchId: string, userId: string) {
  if (!(await recallsRepo.dismiss(groupId, matchId))) throw new AppError(404, "RECALL_MATCH_NOT_FOUND", "Recall alert not found");
  emitGroup(groupId, "cabinet:changed", userId); // other members' alert badges refresh
}
