import { resolveUsedFraction, type UsageReport } from "@oh-my-pi/pi-ai/usage";
import {
  accountIdentityLabel,
  collectUnreportedAccounts,
  type UsageAccountIdentity,
} from "@oh-my-pi/pi-coding-agent/slash-commands/helpers/usage-accounts";

export interface WeeklyLimit {
  id: string;
  label: string;
  remainingPercent: number | null;
  resetsAt: number | null;
}

export interface WeeklyLimitAccount {
  id: string;
  provider: string;
  label: string;
  status: "ready" | "unavailable" | "unsupported";
  fetchedAt: number | null;
  limits: WeeklyLimit[];
}

export interface WeeklyLimitsResponse {
  accounts: WeeklyLimitAccount[];
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Only project display fields: provider reports may contain raw responses and credentials. */
export function buildWeeklyLimits(
  reports: UsageReport[],
  storedAccounts: UsageAccountIdentity[],
  hasUsageProvider: (provider: string) => boolean,
  now = Date.now(),
): WeeklyLimitsResponse {
  const accounts: WeeklyLimitAccount[] = reports.map((report, index) => {
    const metadata = report.metadata ?? {};
    const text = (key: string): string | undefined =>
      typeof metadata[key] === "string" && metadata[key].trim() ? metadata[key].trim() : undefined;
    const identity: UsageAccountIdentity = {
      provider: report.provider,
      type: "oauth",
      email: text("email"),
      accountId: text("accountId") ?? report.limits.find((limit) => limit.scope.accountId)?.scope.accountId,
      projectId: text("projectId") ?? report.limits.find((limit) => limit.scope.projectId)?.scope.projectId,
      orgId: text("orgId"),
      orgName: text("orgName"),
    };
    const limits = report.limits.filter((limit) => {
      // A secondary window is not necessarily weekly (e.g. Codex free plans).
      if (limit.window?.durationMs !== undefined) return limit.window.durationMs === WEEK_MS;
      return [limit.window?.id, limit.scope.windowId].some((id) => id === "7d" || id === "weekly");
    }).map((limit): WeeklyLimit => {
      const used = resolveUsedFraction(limit);
      const resetsAt = limit.window?.resetsAt;
      const reset = typeof resetsAt === "number" && Number.isFinite(resetsAt) ? resetsAt : null;
      const expired = reset !== null && reset <= now && report.fetchedAt < reset;
      return {
        id: limit.id,
        label: limit.label,
        remainingPercent: !expired && used !== undefined && Number.isFinite(used)
          ? Math.min(100, Math.max(0, (1 - used) * 100))
          : null,
        resetsAt: reset,
      };
    });
    return {
      id: `report:${report.provider}:${index}`,
      provider: report.provider,
      label: accountIdentityLabel(identity),
      status: limits.length > 0 ? "ready" : "unsupported",
      fetchedAt: Number.isFinite(report.fetchedAt) ? report.fetchedAt : null,
      limits,
    };
  });

  // Use omp's account attribution: shared workspace IDs must not hide a failed sibling account.
  for (const [index, account] of collectUnreportedAccounts(reports, storedAccounts).entries()) {
    accounts.push({
      id: `missing:${account.provider}:${index}`,
      provider: account.provider,
      label: accountIdentityLabel(account),
      status: hasUsageProvider(account.provider) ? "unavailable" : "unsupported",
      fetchedAt: null,
      limits: [],
    });
  }
  return { accounts };
}
