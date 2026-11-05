import { recordExport, requireActivity } from "~/lib/activities.server";
import { SMALL_N, storyClaims } from "~/lib/data.server";
import type { Route } from "./+types/outcomes.csv";

// Data appendix: every published number with its count, sample size, caveat and source.
// Downloading it is an export: the activity records an `exported` event (format csv).
export async function loader({ params }: Route.LoaderArgs) {
  const activity = await requireActivity(params.activityId);
  if (!activity.programId) throw new Response("Not an outcomes story", { status: 404 });
  const { claims, say } = await storyClaims(activity.programId);
  const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [
    ["program", "claim", "value", "count", "n", "small_sample", "note", "source", "data_as_of"],
    ...claims.map((c) => [say.program.name, c.claim, c.value, c.count, c.n, c.n < SMALL_N ? "yes" : "no", c.note, c.source, "2025-12-31"]),
  ];
  const file = `nssu-${say.program.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-outcomes.csv`;
  await recordExport(activity.id, { format: "csv", artifact: "outcomes-data-appendix", label: file });
  return new Response(rows.map((r) => r.map(esc).join(",")).join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file}"`,
    },
  });
}
