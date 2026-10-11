import type { CabinetItem } from "@contracts/cabinet";

import { StatusChip } from "@/components/ui";
import { daysUntil, shortDate } from "@/lib/format";

/** Expiration chip: ok > 3 days, warn ≤ 3, danger expired; "est." when estimated. The words carry the meaning too. */
export function ExpirationPill({ expiresAt, source }: { expiresAt: string | null; source: CabinetItem["expirationSource"] }) {
  if (!expiresAt) return null;
  const days = daysUntil(expiresAt);
  const [tone, label] =
    days < 0
      ? (["danger", `Expired ${shortDate(expiresAt)}`] as const)
      : days === 0
        ? (["warn", "Expires today"] as const)
        : days <= 3
          ? (["warn", `Expires in ${days}d`] as const)
          : (["ok", `Exp ${shortDate(expiresAt)}`] as const);
  const est = source === "estimated";
  return (
    <StatusChip
      tone={tone}
      label={`${label}${est ? " est." : ""}`}
      accessibilityLabel={`${label}${est ? ", estimated" : ""}`}
    />
  );
}

/** "In stock" (ok) / "Running low" (warn), DESIGN.md §4.6. */
export function StockChip({ status }: { status: CabinetItem["status"] }) {
  return status === "running_low" ? (
    <StatusChip tone="warn" large label="Running low" accessibilityLabel="Status: running low" />
  ) : (
    <StatusChip tone="ok" large label="In stock" accessibilityLabel="Status: in stock" />
  );
}
