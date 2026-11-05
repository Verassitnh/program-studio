import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { Link, useFetcher } from "react-router";
import { HBar, Item, PageHead, Sparkle, Stagger, cx, ease } from "~/components/ui";
import { getActivity, syncRun } from "~/lib/activities.server";
import { syncData } from "~/lib/data.server";
import { getOnboarding } from "~/lib/onboarding.server";
import { dataHealth, getSettings } from "~/lib/workspace.server";
import type { Route } from "./+types/onboarding.sync";

/**
 * Setup step 2: the initial sync runs on arrival (the real pipeline, recorded as a sync activity), then shows
 * what the school's data covers and an informational data-health summary. Nothing here needs a decision:
 * the gaps go to the surveys step as defaults.
 */
export async function loader() {
  const [d, onboarding, settings] = await Promise.all([syncData(), getOnboarding(), getSettings()]);
  const [health, run] = await Promise.all([dataHealth(settings.smallN), onboarding.data.syncId ? syncRun(onboarding.data.syncId) : null]);
  const activity = run?.activity_id ? await getActivity(run.activity_id) : null;
  return { d, health, run, activity };
}

export default function Sync({ loaderData: { d, health, run, activity } }: Route.ComponentProps) {
  const sync = useFetcher<{ ok: boolean; error?: string }>();
  const busy = sync.state !== "idle";
  // The first visit runs the sync; later visits show its result (with "Sync again" for a re-run).
  // No "started" ref: StrictMode's remount aborts the first fetcher, so it must be able to resubmit.
  // A duplicate submit is harmless (the server joins a sync already in flight).
  useEffect(() => {
    if (run) return;
    sync.submit({ intent: "sync" }, { method: "post", action: "/onboarding" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);
  const p = (n: number) => (d.alumni ? Math.round((100 * n) / d.alumni) : 0);
  const rows = [
    { label: "Location", v: p(d.location), red: false },
    { label: "Current job & employer", v: p(d.job), red: false },
    { label: "Reachable by email", v: p(d.email), red: false },
    { label: "Wage", v: p(d.wage), red: true },
  ];
  return (
    <Stagger className="flex grow flex-col gap-[26px] px-12 py-8">
      <PageHead
        eyebrow="Setup · Step 2 · Initial sync and data check"
        title={busy || !run ? "Syncing your school's data…" : "Here's what you know, and what's missing."}
        sub={
          <span className="block leading-[18px]">
            {d.alumni.toLocaleString()} NSSU alumni, {d.courses.toLocaleString()} courses, {d.programs} programs and {d.employers} employers from the Lightcast local import.
          </span>
        }
      />
      <div role="status" className="-mt-2 flex items-center gap-3 text-[13px] leading-5 text-subtle">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span key={busy ? "busy" : run ? "done" : "idle"} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            {busy ? (
              "Running the sync: re-importing ./data and checking every activity…"
            ) : sync.data?.error ? (
              <span className="text-red-deep">{sync.data.error}</span>
            ) : run ? (
              <>
                <span aria-hidden className="text-ink">
                  ✓{" "}
                </span>
                Sync #{run.id} finished: {run.changed_programs.length ? `${run.changed_programs.length} programs changed` : "no changes"}.{" "}
                {activity && (
                  <Link to={activity.path} className="font-medium text-ink underline underline-offset-4 hover:text-red-deep">
                    Open the sync activity
                  </Link>
                )}
              </>
            ) : (
              "Starting…"
            )}
          </motion.span>
        </AnimatePresence>
        {run && !busy && (
          <button
            type="button"
            onClick={() => sync.submit({ intent: "sync" }, { method: "post", action: "/onboarding" })}
            className="rounded-sm text-xs text-subtle underline underline-offset-4 hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
          >
            Sync again
          </button>
        )}
      </div>
      <div className="flex grow gap-14">
        <Item className="flex flex-[1.1] basis-0 flex-col gap-4">
          <div className="text-base font-semibold leading-5 text-ink">Coverage across {d.alumni.toLocaleString()} NSSU alumni</div>
          {rows.map((r, i) => (
            <div key={r.label} className="flex flex-col gap-1.5">
              <div className="flex justify-between text-[13px] leading-4">
                <div className="text-text">{r.label}</div>
                <div className={cx("font-mono", r.red ? "font-semibold text-red" : "text-ink")}>{r.v}%</div>
              </div>
              <HBar pct={r.v} h={8} color={r.red ? "bg-red" : "bg-ink"} delay={0.2 + i * 0.08} />
            </div>
          ))}
          {["Why their employer hired them", "Which courses they actually used"].map((l, i) => (
            <div key={l} className="flex flex-col gap-1.5">
              <div className="flex justify-between text-[13px] leading-4">
                <div className="text-text">{l}</div>
                <div className="font-mono font-semibold text-red">0%</div>
              </div>
              <motion.div
                className="h-2 origin-left rounded-[4px] border border-dashed border-red"
                initial={{ opacity: 0, scaleX: 0.92 }}
                animate={{ opacity: 1, scaleX: 1 }}
                transition={{ duration: 0.6, ease, delay: 0.55 + i * 0.08 }}
              />
            </div>
          ))}
          <div className="text-xs leading-4 text-muted">Red gaps can only be filled by asking. The next step drafts the surveys.</div>
        </Item>
        <Item className="flex flex-1 basis-0 flex-col gap-3">
          <div className="flex items-center gap-2">
            <Sparkle />
            <div className="text-base font-semibold leading-5 text-ink">Data check</div>
          </div>
          {/* Informational: nothing to decide here. Job and wage gaps become the next step's survey defaults. */}
          <ul className="flex flex-col gap-2.5">
            {health.checks.map((c) => (
              <li key={c.key} className={cx("flex flex-col gap-1 rounded-[14px] border px-4 py-3", c.ok ? "border-line" : "border-ink")}>
                <div className="flex justify-between gap-3 text-[13px] leading-4">
                  <span className="font-medium text-ink">{c.label}</span>
                  <span className={cx("shrink-0 font-mono", c.ok ? "text-subtle" : "text-red-deep")}>
                    <span aria-hidden>{c.ok ? "✓ " : ""}</span>
                    {c.value}
                  </span>
                </div>
                <p className="text-xs leading-4 text-subtle">
                  {c.detail}
                  {c.key === "no_job" && " The next step surveys the programs with the most."}
                </p>
              </li>
            ))}
          </ul>
          <Link to="/integrations" className="text-xs text-subtle underline underline-offset-4 hover:text-ink">
            See every dataset and check on Integrations
          </Link>
        </Item>
      </div>
    </Stagger>
  );
}
