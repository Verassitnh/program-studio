import { Link } from "react-router";
import { KindGlyph, StatusLabel } from "~/components/activities";
import { Button, Item, PageHead, Stagger } from "~/components/ui";
import { getActivity, surveyActivity, syncRun } from "~/lib/activities.server";
import { getOnboarding } from "~/lib/onboarding.server";
import { listSurveys } from "~/lib/workspace.server";
import type { Route } from "./+types/onboarding.done";

/** Setup step 4: what setup did, with links to the activities it created (the sync and each sent survey). */
export async function loader() {
  const o = await getOnboarding();
  const run = o.data.syncId ? await syncRun(o.data.syncId) : null;
  const syncActivity = run?.activity_id ? await getActivity(run.activity_id) : null;
  const sent = (await listSurveys()).filter((s) => o.data.surveys?.some((r) => r.ok && r.programId === s.programId && r.audience === s.audience) && s.status === "sent");
  const surveys = (await Promise.all(sent.map((s) => surveyActivity(s.id)))).filter((a) => a !== null);
  return { run, syncActivity, surveys, failed: (o.data.surveys ?? []).filter((r) => !r.ok) };
}

export default function Done({ loaderData: { run, syncActivity, surveys, failed } }: Route.ComponentProps) {
  const threads = [...(syncActivity ? [syncActivity] : []), ...surveys];
  return (
    <Stagger className="flex grow flex-col gap-7 px-12 py-8">
      <PageHead
        eyebrow="Setup · Done"
        title="You're set up."
        sub="From here, every program review and outcomes story starts straight in the analysis, on this data."
      />
      <Item className="flex flex-col gap-3">
        <div className="label text-muted">What setup did</div>
        <ul className="flex max-w-[720px] flex-col">
          {threads.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-4 border-b border-line py-3 text-[13px]">
              <Link to={t.path} className="flex min-w-0 items-center gap-2 font-medium text-ink underline-offset-4 hover:underline">
                <KindGlyph kind={t.kind} />
                <span className="truncate">{t.title}</span>
                <span className="font-normal text-subtle">· {t.kindLabel}</span>
              </Link>
              <StatusLabel status={t.status} className="text-xs" />
            </li>
          ))}
          {!run && <li className="py-3 text-[13px] text-subtle">No sync ran during setup. Run one any time from Integrations.</li>}
          {!surveys.length && <li className="py-3 text-[13px] text-subtle">No surveys sent. Send them any time from Surveys or from a program review.</li>}
        </ul>
        {failed.length > 0 && <p className="text-xs text-red-deep">Not sent: {failed.map((f) => `${f.name} (${f.message})`).join("; ")}</p>}
        <p className="text-xs leading-4 text-muted">Each is an activity in the sidebar. Survey responses are simulated (demo).</p>
      </Item>
      <Item>
        <Button tone="ink" size="lg" to="/">
          Go to Programs →
        </Button>
      </Item>
    </Stagger>
  );
}
