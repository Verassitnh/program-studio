import { redirect } from "react-router";
import { requireActivity } from "~/lib/activities.server";
import type { Route } from "./+types/review.retired";

/**
 * /a/:id/review/{connect,sync,survey} (and unknown stages): reviews no longer contain data steps
 * (connecting and syncing happen in setup; surveys are their own activities). Opens the review's Explore stage.
 */
export async function loader({ params }: Route.LoaderArgs) {
  const a = await requireActivity(params.activityId);
  throw redirect(a.kind === "review" ? `/a/${a.id}/review/explore` : a.path);
}
