import { redirect } from "react-router";
import { getOnboarding } from "~/lib/onboarding.server";

/** /onboarding resumes where setup left off; a completed setup re-runs from the first step. */
export async function loader() {
  const o = await getOnboarding();
  return redirect(`/onboarding/${o.status === "completed" || o.status === "not_started" ? "connect" : o.step}`);
}
