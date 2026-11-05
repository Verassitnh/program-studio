import { Form, Link, redirect, useNavigation } from "react-router";
import { useActivity } from "~/components/activities";
import { ActivityHeader, Button, HBar, Item, PageHead, Stagger, cx } from "~/components/ui";
import { shortDate } from "~/lib/activity";
import { requireActivity } from "~/lib/activities.server";
import { getSurvey, remindSurvey } from "~/lib/workspace.server";
import type { Route } from "./+types/activity.survey";

/**
 * A survey activity: one sent survey, on a single page (no steps). Recipients and audience are real
 * counts; responses are SIMULATED (the workspace demo clock) and labelled "demo". The activity completes when
 * the survey is closed by hand, here ("Close activity") or on the Surveys page; the two stay in step.
 */
export async function loader({ params }: Route.LoaderArgs) {
  const activity = await requireActivity(params.activityId);
  if (activity.kind !== "survey") throw redirect(activity.path);
  const survey = activity.refId ? await getSurvey(Number(activity.refId)) : null;
  if (!survey) throw new Response("Survey not found", { status: 404 });
  return { survey };
}

export async function action({ params, request }: Route.ActionArgs) {
  const activity = await requireActivity(params.activityId);
  const form = await request.formData();
  if (form.get("intent") === "remind" && activity.refId) {
    const r = await remindSurvey(Number(activity.refId));
    return r.ok ? { message: r.message } : { error: r.error };
  }
  return { error: "Unknown action" };
}

const shortDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });

export default function SurveyActivity({ loaderData: { survey: s }, actionData }: Route.ComponentProps) {
  const a = useActivity();
  const nav = useNavigation();
  const closed = s.status === "closed";
  const demo = s.demo;
  const audience = s.audience === "alumni" ? "alumni" : "employers";
  return (
    <div className="flex min-h-screen flex-col">
      {/* Single page: sending created this activity; no steps to walk through. */}
      <ActivityHeader
        title={a?.title ?? s.programName}
        subtitle={`Sent to ${s.recipients.toLocaleString()} ${audience} · ${s.sentAt ? shortDateTime(s.sentAt) : "—"}`}
        cta={closed ? { label: "Open in Surveys →", to: `/surveys?s=${s.id}` } : { label: "Send a reminder", to: "", form: "survey-remind" }}
      />
      <Stagger className="flex grow flex-col gap-7 px-12 py-8">
        <PageHead
          eyebrow={closed ? "Closed · responses frozen" : "Live · collecting responses"}
          title={`Sent to ${s.recipients.toLocaleString()} ${audience === "alumni" ? "alumni" : "employers"}.`}
          sub={`${s.programName} · ${s.gapLabel}. Sent ${s.sentAt ? shortDateTime(s.sentAt) : ""}.`}
        />
        <Item className="flex gap-10">
          <div className="flex w-[320px] flex-col gap-2">
            <div className="label text-muted">Responses <span className="text-red">· demo</span></div>
            <div className="text-5xl font-semibold leading-[52px] tracking-[-0.04em] text-ink tabular-nums">
              {demo ? demo.responses.toLocaleString() : "0"}
              <span className="text-xl font-normal text-subtle"> / {s.recipients.toLocaleString()}</span>
            </div>
            <HBar pct={demo?.rate ?? 0} h={6} color="bg-red" />
            <div className="text-xs leading-4 text-subtle">
              {demo ? `${demo.rate}% response rate · ${demo.nonResponders.toLocaleString()} haven't answered · ${demo.label}` : "No responses yet."}
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-2 text-[13px] leading-5 text-text">
            <div className="label text-muted">Recipients (from your records)</div>
            {s.breakdown.kind === "alumni" ? (
              <ul className="flex flex-col gap-1 tabular-nums">
                <li>{s.breakdown.email.toLocaleString()} of {s.breakdown.alumni.toLocaleString()} alumni have an email on file</li>
                <li>{s.breakdown.noJobEmail.toLocaleString()} of the {s.breakdown.noJob.toLocaleString()} with no job on record are reachable</li>
                <li>{s.breakdown.noWage.toLocaleString()} have no wage on record</li>
              </ul>
            ) : (
              <ul className="flex flex-col gap-1 tabular-nums">
                <li>{s.breakdown.employers.toLocaleString()} employers of {s.breakdown.grads.toLocaleString()} grads</li>
                {s.breakdown.top.slice(0, 4).map((e) => (
                  <li key={e.employer} className="text-subtle">
                    {e.employer} · {e.grads} grads
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Item>
        <Item className="flex flex-col gap-2">
          <div className="label text-muted">Timeline</div>
          <ol className="flex flex-col gap-1.5 text-[13px] leading-5">
            {s.events.map((e) => (
              <li key={e.id} className="flex gap-3">
                <span className="w-24 shrink-0 font-mono text-xs text-muted">{shortDate(e.at)}</span>
                <span className="capitalize text-ink">{e.type}</span>
              </li>
            ))}
          </ol>
        </Item>
        <Form id="survey-remind" method="post" className="hidden">
          <input type="hidden" name="intent" value="remind" />
        </Form>
        <div role="status" className={cx("text-[13px]", actionData?.error ? "text-red-deep" : "text-subtle")}>
          {nav.state === "submitting" ? "Sending reminder…" : actionData?.error ?? actionData?.message ?? ""}
        </div>
        <Item className="mt-auto flex items-center justify-between gap-4 text-xs leading-4 text-muted">
          <span>
            Response counts are simulated (demo) and never added to a real metric. Closing the activity closes the survey; a closed survey can be sent again as a new wave
            from Surveys.
          </span>
          <Link to={`/surveys?s=${s.id}`} className="shrink-0 underline underline-offset-4 hover:text-ink">
            Manage in Surveys
          </Link>
          {s.activityId && (
            <Button size="sm" tone="ghost" to={`/a/${s.activityId}`}>
              Back to the review
            </Button>
          )}
        </Item>
      </Stagger>
    </div>
  );
}
