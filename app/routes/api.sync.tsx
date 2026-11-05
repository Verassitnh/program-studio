import { syncNow } from "~/lib/activities.server";
import type { Route } from "./+types/api.sync";

/**
 * POST /api/sync { demoCorrections?: "1", source?: string } → { sync }
 * Re-imports the example data (optionally with the SIMULATED demo corrections in data/corrections),
 * then auto-closes or flags activities whose program data changed. Same pipeline as `npm run db:sync`.
 * Without demo corrections the data is static, so a sync changes nothing and closes nothing.
 */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return Response.json({ error: "POST only" }, { status: 405 });
  const form = await request.formData();
  const withDemoCorrections = form.get("demoCorrections") === "1";
  const source = String(form.get("source") ?? "ui").slice(0, 40) || "ui";
  try {
    const sync = await syncNow({ source, withDemoCorrections });
    return { sync };
  } catch (err) {
    // The failed run is still recorded as a sync activity (status Failed, error in its note).
    return Response.json({ error: `Sync failed: ${(err as Error).message}`, activityId: (err as { activityId?: string }).activityId ?? null }, { status: 500 });
  }
}

export const loader = () => Response.json({ error: "POST to sync" }, { status: 405 });
