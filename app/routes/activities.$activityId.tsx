import { redirect } from "react-router";
import { acknowledgeReview, closeActivity, getActivity, recordExport, reopenActivity, saveState, visitStage, type ExportFormat } from "~/lib/activities.server";
import type { Route } from "./+types/activities.$activityId";

/**
 * Every activity write, by `intent`:
 *   visit   { stage }                        stage visit (moves the thread to the top)
 *   state   { key, value: JSON }             saves part of the activity's state
 *   close   { note? }                        manual close (allowed at any stage)
 *   reopen                                   back to running
 *   ack                                      clears "Data updated — review again"
 *   export  { format, artifact, label? }     records an export (packet printed, story saved, CSV)
 * Returns { activity } for fetchers; plain form posts (no JS) are redirected back.
 */
export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  const id = params.activityId;
  const intent = String(form.get("intent") ?? "");
  let activity;
  switch (intent) {
    case "visit":
      activity = await visitStage(id, String(form.get("stage") ?? ""));
      break;
    case "state": {
      const key = String(form.get("key") ?? "");
      if (!/^[a-z][a-zA-Z0-9_]{0,40}$/.test(key)) return Response.json({ error: "Bad state key" }, { status: 400 });
      let value: unknown;
      try {
        value = JSON.parse(String(form.get("value") ?? "null"));
      } catch {
        return Response.json({ error: "value must be JSON" }, { status: 400 });
      }
      activity = await saveState(id, key, value);
      break;
    }
    case "close":
      activity = await closeActivity(id, String(form.get("note") ?? ""));
      break;
    case "reopen":
      activity = await reopenActivity(id);
      break;
    case "ack":
      activity = await acknowledgeReview(id);
      break;
    case "export": {
      const format = String(form.get("format") ?? "") as ExportFormat;
      if (!["pdf", "csv", "print"].includes(format)) return Response.json({ error: "format must be pdf, csv or print" }, { status: 400 });
      const label = form.get("label");
      activity = await recordExport(id, { format, artifact: String(form.get("artifact") ?? "artifact"), label: typeof label === "string" ? label : undefined });
      break;
    }
    default:
      return Response.json({ error: `Unknown intent "${intent}"` }, { status: 400 });
  }
  const back = form.get("redirectTo");
  if (typeof back === "string" && back.startsWith("/") && !back.startsWith("//")) return redirect(back);
  return { activity };
}

/** GET opens the activity at its last stage (the thread's link target). */
export async function loader({ params }: Route.LoaderArgs) {
  const a = await getActivity(params.activityId);
  return redirect(a ? a.path : "/");
}
