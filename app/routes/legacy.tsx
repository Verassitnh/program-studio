import { redirect } from "react-router";
import { RETIRED_STAGES, isStage, type Kind } from "~/lib/activity";
import { DEFAULT_PROGRAM, findLive } from "~/lib/activities.server";
import { getOnboarding } from "~/lib/onboarding.server";
import type { Route } from "./+types/legacy";

/**
 * /review/:stage and /outcomes/:stage from before activities were records. A GET never creates anything
 * (prefetchers and crawlers follow links): it redirects into the default program's live activity of that
 * kind if one exists, otherwise to the dashboard. Starting work is POST /activities/new.
 * The retired review data stages (connect, sync, survey) go to workspace setup until it's complete.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const [section, stage] = url.pathname.split("/").filter(Boolean);
  const kind: Kind = section === "outcomes" ? "outcomes" : "review";
  const onboarding = await getOnboarding();
  if (kind === "review" && stage && RETIRED_STAGES.includes(stage) && onboarding.status !== "completed") return redirect("/onboarding");
  const live = await findLive(DEFAULT_PROGRAM, kind);
  if (!live) return redirect("/");
  return redirect((isStage(kind, stage) ? `/a/${live.id}/${kind}/${stage}` : live.path) + url.search);
}
