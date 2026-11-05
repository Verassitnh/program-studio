import { Link, redirect } from "react-router";
import { StatusLabel, useActivity } from "~/components/activities";
import { ActivityHeader, Item, PageHead, Stagger, cx } from "~/components/ui";
import { KINDS, shortDate } from "~/lib/activity";
import { getActivity, requireActivity, syncRun } from "~/lib/activities.server";
import { dataHealth, getSettings } from "~/lib/workspace.server";
import type { Route } from "./+types/activity.sync";

/**
 * A sync activity: one run of the data sync (setup, Integrations "Sync now", or `npm run db:sync`).
 * Single page (no steps): it lands on the result. It finishes on its own: Completed (close_reason 'finished') or Failed with the error.
 * Shows what changed, which activities it auto-closed or flagged, the data-health summary, and any
 * corrections applied (the demo ones are SIMULATED).
 */
export async function loader({ params }: Route.LoaderArgs) {
  const activity = await requireActivity(params.activityId);
  if (activity.kind !== "sync") throw redirect(activity.path);
  const [sync, settings] = await Promise.all([activity.refId ? syncRun(Number(activity.refId)) : null, getSettings()]);
  const health = await dataHealth(settings.smallN).catch(() => null);
  const touched = sync ? await Promise.all([...sync.closed, ...sync.flagged].map((e) => getActivity(e.id))) : [];
  return { sync, health, links: Object.fromEntries(touched.filter(Boolean).map((t) => [t!.id, t!])) };
}

export default function SyncActivity({ loaderData: { sync, health, links } }: Route.ComponentProps) {
  const a = useActivity();
  const failed = a?.closeReason === "failed";
  const running = a?.lifecycle !== "closed";
  const state = (a?.state ?? {}) as { source?: string; withDemoCorrections?: boolean; records?: number; files?: number; corrections?: { file: string; simulated: boolean; records: number }[] };
  const entry = (e: { id: string; title: string; kind: string }, verb: string) => {
    const t = links[e.id];
    return (
      <li key={e.id} className="flex items-center justify-between gap-3 border-b border-line py-2 text-[13px]">
        <span className="min-w-0 truncate">
          {t ? (
            <Link to={t.path} className="font-medium text-ink underline-offset-4 hover:underline">
              {e.title}
            </Link>
          ) : (
            e.title
          )}{" "}
          <span className="text-subtle">· {KINDS[e.kind as keyof typeof KINDS]?.label ?? e.kind}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-subtle">
          {verb}
          {t && <StatusLabel status={t.status} />}
        </span>
      </li>
    );
  };
  return (
    <div className="flex min-h-screen flex-col">
      {/* Single page: running the sync created this activity; it lands on the result. */}
      <ActivityHeader
        title={a?.title ?? "Data sync"}
        subtitle={`From ${state.source ?? "sync"} · ${a ? shortDate(a.openedAt) : ""}`}
        cta={{ label: "Sync history on Integrations →", to: "/integrations" }}
      />
      <Stagger className="flex grow flex-col gap-7 px-12 py-8">
        <PageHead
          eyebrow={failed ? "Failed" : running ? "Running" : "Finished"}
          title={failed ? "The sync failed." : running ? "Syncing…" : sync && sync.changed_programs.length ? `${sync.changed_programs.length} program${sync.changed_programs.length === 1 ? "" : "s"} changed.` : "Nothing changed."}
          sub={
            failed
              ? a?.closeNote
              : sync
                ? `Re-imported ${state.records?.toLocaleString() ?? "—"} records from ${state.files ?? "—"} files${sync.with_demo_corrections ? ", with the simulated demo corrections" : ""}. ${
                    sync.changed_programs.length ? "" : "The example data is static, so without corrections a sync changes nothing and closes nothing."
                  }`
                : undefined
          }
        />
        {sync && (
          <Item className="flex gap-10">
            <div className="flex flex-1 flex-col gap-2">
              <div className="label text-muted">Programs with changed data</div>
              {sync.changed_programs.length ? (
                <ul className="flex flex-col text-[13px]">
                  {sync.changed_programs.map((p) => (
                    <li key={p.id} className="border-b border-line py-2 text-ink">
                      {p.name}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-subtle">None.</p>
              )}
            </div>
            <div className="flex flex-[1.3] flex-col gap-2">
              <div className="label text-muted">Activities this sync touched</div>
              {sync.closed.length + sync.flagged.length ? (
                <ul className="flex flex-col">
                  {sync.closed.map((e) => entry(e, "auto-closed"))}
                  {sync.flagged.map((e) => entry(e, "flagged: data updated, issues remain"))}
                </ul>
              ) : (
                <p className="text-[13px] text-subtle">None auto-closed or flagged.</p>
              )}
            </div>
          </Item>
        )}
        {state.corrections && state.corrections.length > 0 && (
          <Item className="rounded-xl border border-dashed border-muted px-4 py-3 text-[13px] leading-5 text-subtle">
            <span className="font-medium text-ink">Corrections applied: </span>
            {state.corrections.map((c) => `${c.file} (${c.records} records${c.simulated ? ", SIMULATED demo data" : ""})`).join("; ")}
          </Item>
        )}
        {health && (
          <Item className="flex flex-col gap-2">
            <div className="label text-muted">Data health after this sync</div>
            <ul className="grid grid-cols-2 gap-3">
              {health.checks.map((c) => (
                <li key={c.key} className={cx("flex flex-col gap-1 rounded-xl border px-4 py-3", c.ok ? "border-line" : "border-ink")}>
                  <div className="flex justify-between gap-3 text-[13px]">
                    <span className="text-ink">{c.label}</span>
                    <span className={cx("font-mono", c.ok ? "text-subtle" : "text-red-deep")}>
                      <span aria-hidden>{c.ok ? "✓ " : ""}</span>
                      {c.value}
                    </span>
                  </div>
                  <p className="text-xs leading-4 text-subtle">{c.detail}</p>
                </li>
              ))}
            </ul>
          </Item>
        )}
      </Stagger>
    </div>
  );
}
