import { redirect } from "react-router";
import { requireActivity } from "~/lib/activities.server";
import type { Route } from "./+types/outcomes.retired";

/** /a/:id/outcomes/{scan,say} and unknown stages: the story opens on its report (Story stage) or where it left off. */
export async function loader({ params }: Route.LoaderArgs) {
  const a = await requireActivity(params.activityId);
  throw redirect(params.retired === "scan" || params.retired === "say" ? `/a/${a.id}/outcomes/story` : a.path);
}
