import { redirect } from "react-router";
import { requireActivity } from "~/lib/activities.server";
import type { Route } from "./+types/outcomes.index";

export async function loader({ params }: Route.LoaderArgs) {
  const a = await requireActivity(params.activityId);
  return redirect(a.path);
}
