import { redirect } from "react-router";
import { DEFAULT_PROGRAM, findLive } from "~/lib/activities.server";

/** Old download URL: the default program's live outcomes story CSV, if there is one. A GET never creates an activity. */
export async function loader() {
  const live = await findLive(DEFAULT_PROGRAM, "outcomes");
  return redirect(live ? `/a/${live.id}/outcomes/data.csv` : "/");
}
