import { useEffect, useMemo } from "react";
import { Form, redirect, useFetcher, useLocation, useRouteLoaderData, type ShouldRevalidateFunctionArgs } from "react-router";
import { AnimatedOutlet } from "~/components/flow";
import { Button, StageBar, StageBarContext, type Stage } from "~/components/ui";
import { syncNow } from "~/lib/activities.server";
import { dismissBanner, getOnboarding, mergeData, sendGapSurveys, skipOnboarding, visitStep, type Step } from "~/lib/onboarding.server";

// Client-safe copy of the step list (onboarding.server can't be imported by the component).
const STEP_KEYS: Step[] = ["connect", "sync", "surveys", "done"];
const isStep = (s: unknown): s is Step => STEP_KEYS.includes(s as Step);
import type { Route } from "./+types/onboarding";

/**
 * Workspace setup, once per workspace: connect sources → initial sync and data check → fill the gaps with
 * surveys → done. Fullscreen like an activity (the shell hides the sidebar on /onboarding); ← or Esc goes
 * to the dashboard and leaves setup resumable from the sidebar's "Finish setup" row or Integrations.
 */
export const loader = async () => ({ onboarding: await getOnboarding() });

export type OnboardingLayoutData = Awaited<ReturnType<typeof loader>>;
export const useOnboarding = () => (useRouteLoaderData("routes/onboarding") as OnboardingLayoutData | undefined)?.onboarding;

/**
 * Every setup write, by `intent`:
 *   step  { step }                        progress (reaching "done" completes setup)
 *   skip                                  "Skip for now" → dashboard
 *   dismiss                               hides the sidebar's "Finish setup" row
 *   sync  { demoCorrections? }            the real sync (same pipeline as `npm run db:sync`)
 *   send  { pick[] = programId:audience } creates and sends surveys, then goes to "done"
 */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  switch (intent) {
    case "step": {
      const step = form.get("step");
      if (isStep(step)) await visitStep(step);
      return { ok: true };
    }
    case "skip":
      await skipOnboarding();
      return redirect("/");
    case "dismiss":
      await dismissBanner();
      return { ok: true };
    case "sync": {
      try {
        const sync = await syncNow({ source: "onboarding", withDemoCorrections: form.get("demoCorrections") === "1" });
        await mergeData({ syncId: sync.id });
        return { ok: true, sync };
      } catch (err) {
        return { ok: false, error: `Sync failed: ${(err as Error).message}` };
      }
    }
    case "send": {
      const picks = form
        .getAll("pick")
        .map(String)
        .map((p) => {
          const [programId, audience] = p.split(":");
          return { programId, audience: audience === "employers" ? ("employers" as const) : ("alumni" as const) };
        })
        .filter((p) => p.programId);
      const results = await sendGapSurveys(picks);
      const failed = results.filter((r) => !r.ok);
      if (failed.length && failed.length === results.length) return { ok: false, error: failed.map((f) => `${f.name}: ${f.message}`).join(" ") };
      return redirect("/onboarding/done");
    }
    default:
      return Response.json({ error: `Unknown intent "${intent}"` }, { status: 400 });
  }
}

// Progress writes don't change what the steps show.
export const shouldRevalidate = ({ formData, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) =>
  formData?.get("intent") === "step" ? false : defaultShouldRevalidate;

export const meta: Route.MetaFunction = ({ location }) => {
  const step = STEPS.find((s) => s.key === location.pathname.split("/")[2])?.label;
  return [{ title: [step, "Workspace setup", "Program Studio"].filter(Boolean).join(" · ") }];
};

const STEPS: { key: Step; label: string }[] = [
  { key: "connect", label: "Connect sources" },
  { key: "sync", label: "Sync & check" },
  { key: "surveys", label: "Fill gaps with surveys" },
  { key: "done", label: "Done" },
];

const CTA: Record<Step, { label: string; to: string; tone?: "red"; form?: string }> = {
  connect: { label: "Continue to Sync →", to: "/onboarding/sync" },
  sync: { label: "Continue to Surveys →", to: "/onboarding/surveys" },
  surveys: { label: "Send surveys & finish →", to: "", tone: "red", form: "send-surveys" },
  done: { label: "Go to Programs →", to: "/" },
};

export default function OnboardingLayout({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const key = (pathname.split("/")[2] || "connect") as Step;
  const current = Math.max(0, STEPS.findIndex((s) => s.key === key));
  const progress = useFetcher();
  const status = loaderData.onboarding.status;

  // Record the step reached (client-side, so prefetching a step link never counts).
  useEffect(() => {
    if (!isStep(key)) return;
    progress.submit({ intent: "step", step: key }, { method: "post", action: "/onboarding" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const extras = useMemo(
    () => ({
      activity: "Workspace setup",
      kicker: null, // setup guides you; it isn't an activity itself
      status: <span className="text-subtle">{status === "completed" ? "Completed · re-running" : `Step ${current + 1} of ${STEPS.length}`}</span>,
      actions:
        key === "done" ? null : (
          <Form method="post" action="/onboarding">
            <input type="hidden" name="intent" value="skip" />
            <Button tone="ghost" type="submit">
              Skip for now
            </Button>
          </Form>
        ),
    }),
    [status, current, key],
  );

  return (
    <StageBarContext.Provider value={extras}>
      <div className="flex min-h-screen flex-col [--stagebar-h:113px]">
        <StageBar
          title="North Sound State University"
          subtitle="Set up once: every activity then starts from this data"
          stages={STEPS.map((s) => ({ ...s, to: `/onboarding/${s.key}` })) as Stage[]}
          current={current}
          progress={key === "done" ? 1 : 0.5}
          cta={CTA[key] ?? CTA.connect}
        />
        <AnimatedOutlet className="flex grow flex-col" />
      </div>
    </StageBarContext.Provider>
  );
}


