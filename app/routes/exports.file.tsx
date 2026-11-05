import { buildCsv } from "~/lib/workspace.server";
import type { Route } from "./+types/exports.file";

/**
 * Quick-export CSVs for any School of Business program: /exports/:programId/outcomes.csv and
 * /exports/:programId/alignment.csv. The /exports page records each export (studio.exports) through its
 * action before it starts the download, so re-downloading from the library doesn't add rows.
 */
export async function loader({ params }: Route.LoaderArgs) {
  const kind = params.file === "outcomes.csv" ? "outcomes" : params.file === "alignment.csv" ? "alignment" : null;
  if (!kind) throw new Response("Not found", { status: 404 });
  const out = await buildCsv(params.programId, kind);
  if (!out) throw new Response("Not found", { status: 404 });
  return new Response(out.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${out.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
