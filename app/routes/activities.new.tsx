import { redirect } from "react-router";
import { isAnalysis, isKind } from "~/lib/activity";
import { getActivity, startActivity, surveyActivity } from "~/lib/activities.server";
import { createSurvey, sendSurvey, surveyForProgram } from "~/lib/workspace.server";
import type { Route } from "./+types/activities.new";

/**
 * POST { programId, kind: "review" | "outcomes" | "survey", stage?, audience?, from? }
 *   review / outcomes  resume the program's latest non-closed activity of that kind, or open one
 *   survey             create and send the program's survey for `audience` (alumni by default), or reuse the
 *                      one already out; sending is what creates the survey activity. `from` links the survey to
 *                      the review it was sent from.
 * Then redirects into the activity, or returns { activity } when `stay=1` (fetchers that keep the page).
 * Syncs are workspace-level: they start from Sync now / setup / the CLI, not here.
 */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const programId = String(form.get("programId") ?? "");
  const kind = form.get("kind");
  const stage = form.get("stage");
  const stay = form.get("stay") === "1";
  if (!programId || !isKind(kind) || kind === "sync") {
    return Response.json({ error: "programId and kind ('review' | 'outcomes' | 'survey') are required" }, { status: 400 });
  }
  let activity;
  if (isAnalysis(kind)) {
    activity = (await startActivity({ programId, kind, stage: typeof stage === "string" ? stage : undefined })).activity;
  } else {
    const audience = form.get("audience") === "employers" ? "employers" : "alumni";
    const from = await getActivity(String(form.get("from") ?? "") || undefined);
    const current = (await surveyForProgram(programId))[audience];
    let id = current && current.status !== "closed" ? current.id : null;
    if (!id) {
      const created = await createSurvey({ programId, audience, activityId: from?.id ?? null });
      if (!created.ok) return Response.json({ error: created.error }, { status: 400 });
      id = created.id;
    }
    if (!current || current.status === "draft" || current.status === "closed") {
      const sent = await sendSurvey(id);
      if (!sent.ok) return Response.json({ error: sent.error }, { status: 400 });
    }
    activity = await surveyActivity(id);
    if (!activity) return Response.json({ error: "The survey is scheduled, not sent yet." }, { status: 409 });
  }
  return stay ? { activity } : redirect(activity.path);
}

// Starting work is a POST (it creates records); a stray GET goes home.
export const loader = () => redirect("/");
