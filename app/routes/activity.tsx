import { useEffect, useMemo } from "react";
import { Outlet, redirect, useFetcher, useLocation, type ShouldRevalidateFunctionArgs } from "react-router";
import { ActivityBanner, ActivityBarActions, KindGlyph, StatusLabel } from "~/components/activities";
import { StageBarContext } from "~/components/ui";
import { STAGE_LABELS, isStage } from "~/lib/activity";
import { requireActivity } from "~/lib/activities.server";
import type { Route } from "./+types/activity";

/** Loads the activity in the URL. Stage loaders read the program from it (programOf(params)). */
export async function loader({ params, request }: Route.LoaderArgs) {
  const activity = await requireActivity(params.activityId);
  // A review id under /outcomes (or vice versa) goes to the right flow.
  // Client data requests end in ".data" (/a/:id/survey.data); strip it or single-segment kinds redirect forever.
  const section = new URL(request.url).pathname.replace(/\.data$/, "").split("/")[3];
  if (section && section !== activity.kind) throw redirect(activity.path);
  return { activity, now: Date.now() };
}

/** Re-run after activity writes (stage visits, state saves, close/reopen) so the status and banner follow. */
export function shouldRevalidate({ formAction, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (formAction?.startsWith("/activities/")) return true;
  return defaultShouldRevalidate;
}

/** Most specific first (WCAG 2.4.2): "Explore · Business Administration, B.S. · Program review · Program Studio". */
export const meta: Route.MetaFunction = ({ loaderData, location }) => {
  if (!loaderData) return [];
  const stage = STAGE_LABELS[location.pathname.split("/")[4] ?? ""];
  return [{ title: [stage, loaderData.activity.title, loaderData.activity.kindLabel, "Program Studio"].filter(Boolean).join(" · ") }];
};

export default function ActivityLayout({ loaderData }: Route.ComponentProps) {
  const { activity: a, now } = loaderData;
  const { pathname } = useLocation();
  const stage = pathname.split("/")[4];
  const visit = useFetcher();

  // Each stage visit moves the activity's stage and bumps it to the top of the threads. Recorded from the
  // client (not the loader) so link prefetching on hover never counts as a visit. Closed activities are read-only.
  useEffect(() => {
    if (a.lifecycle === "closed" || !isStage(a.kind, stage) || stage === a.stage) return;
    visit.submit({ intent: "visit", stage }, { method: "post", action: `/activities/${a.id}`, defaultShouldRevalidate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id, stage, a.lifecycle]);

  const extras = useMemo(
    () => ({
      activity: a.kindLabel,
      icon: <KindGlyph kind={a.kind} className="text-muted" />,
      status: <StatusLabel status={a.status} />,
      actions: <ActivityBarActions activity={a} />,
      banner: <ActivityBanner activity={a} now={now} />,
    }),
    [a, now],
  );
  return (
    <StageBarContext.Provider value={extras}>
      <Outlet />
    </StageBarContext.Provider>
  );
}
