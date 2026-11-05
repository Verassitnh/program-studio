import { redirect } from "react-router";
import { requireActivity } from "~/lib/activities.server";
import type { Route } from "./+types/activity.index";

/** /a/:id opens the activity at its last stage. */
export async function loader({ params }: Route.LoaderArgs) {
  return redirect((await requireActivity(params.activityId)).path);
}
