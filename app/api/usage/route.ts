import { collectStoredAccounts } from "@oh-my-pi/pi-coding-agent/slash-commands/helpers/usage-accounts";
import { getOmpRuntime } from "@/lib/omp-runtime";
import { buildWeeklyLimits } from "@/lib/weekly-limits";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { authStorage } = await getOmpRuntime();
    // The SDK owns per-account caching, request coalescing, OAuth refresh and backoff.
    const reports = await authStorage.usage.reports({ signal: request.signal });
    const result = buildWeeklyLimits(
      reports ?? [],
      collectStoredAccounts(authStorage),
      (provider) => authStorage.usage.providerFor(provider) !== undefined,
    );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Never forward upstream errors: they can contain auth headers or response bodies.
    return Response.json({ error: "Unable to load weekly limits" }, { status: 503 });
  }
}
