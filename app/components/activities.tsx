import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useFetcher, useLocation, useRouteLoaderData } from "react-router";
import { ago, isAnalysis, longAgo, shortDate, type ActivityStatus, type ActivityView, type Kind } from "~/lib/activity";
import { MenuButton } from "./menu";
import { Button, cx, ease } from "./ui";

/* ------------------------------------------------------------- data */

export type ActivityLayoutData = { activity: ActivityView; now: number };

/** The activity the current /a/:id route is showing (undefined outside activities). */
export function useActivity() {
  return (useRouteLoaderData("routes/activity") as ActivityLayoutData | undefined)?.activity;
}

const actionFor = (id: string) => `/activities/${id}`;

/**
 * One key of the activity's server-side state. Reads what the activity loader rendered (so SSR shows the
 * saved value, no flash), keeps an optimistic local copy, and saves through a fetcher. Revalidation is limited
 * to the activity layout (status/stage), so heavy stage loaders don't re-run on every toggle.
 */
export function useActivityState<T>(key: string, fallback: T) {
  const activity = useActivity();
  const fetcher = useFetcher();
  const saved = activity?.state?.[key] as T | undefined;
  const [local, setLocal] = useState<T | undefined>(saved);
  const savedJson = JSON.stringify(saved ?? null);
  // A different activity (or a revalidation that brought a newer saved value) resets the local copy.
  useEffect(() => setLocal(saved), [activity?.id, savedJson]); // eslint-disable-line react-hooks/exhaustive-deps
  const value = (local ?? saved ?? fallback) as T;
  const current = useRef(value);
  current.current = value;
  const readOnly = activity?.lifecycle === "closed";
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      if (!activity || readOnly) return;
      const v = typeof next === "function" ? (next as (p: T) => T)(current.current) : next;
      current.current = v;
      setLocal(v);
      fetcher.submit({ intent: "state", key, value: JSON.stringify(v) }, { method: "post", action: actionFor(activity.id), defaultShouldRevalidate: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activity?.id, readOnly, key],
  );
  return [value, set, { readOnly, hasSaved: saved !== undefined || local !== undefined }] as const;
}

/** Outcomes "Fix the story" choices, saved on the activity (the stage bar counts them too). */
export type FixState = { pay: boolean; slow: boolean; sent: boolean };
export const FIX_DEFAULT: FixState = { pay: true, slow: true, sent: false };

/** Records an export (then runs `then`, e.g. window.print) without re-running the page's loaders. */
export function useRecordExport() {
  const activity = useActivity();
  const fetcher = useFetcher();
  return useCallback(
    (payload: { format: "pdf" | "csv" | "print"; artifact: string; label?: string }) => {
      if (!activity) return;
      fetcher.submit({ intent: "export", ...payload }, { method: "post", action: actionFor(activity.id), defaultShouldRevalidate: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activity?.id],
  );
}

/* ------------------------------------------------------------- status */

/**
 * Status label: a dot (or ✓) plus words, so color is never the only cue. Label changes cross-fade.
 *   Collecting data  muted, a few soft pulses   In progress  ink   Exported  red-deep
 *   Completed        ✓ muted                    Closed early muted, hollow dot
 */
export function StatusLabel({ status, className }: { status: ActivityStatus; className?: string }) {
  const tone = {
    collecting: "text-subtle",
    in_progress: "text-ink",
    exported: "text-red-deep",
    completed: "text-subtle",
    closed_early: "text-muted",
    failed: "text-red-deep",
  }[status.key];
  return (
    <span className={cx("relative inline-grid", className)}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={status.key}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.15, ease: "easeOut" } }}
          exit={{ opacity: 0, transition: { duration: 0.1, ease: "easeOut" } }}
          className={cx("inline-flex items-center gap-1.5 whitespace-nowrap", tone)}
        >
          {status.key === "completed" || status.key === "failed" ? (
            <span aria-hidden className="text-[10px] leading-none">
              {status.key === "failed" ? "✕" : "✓"}
            </span>
          ) : (
            <span aria-hidden className="relative flex h-1.5 w-1.5 shrink-0">
              {status.key === "collecting" && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-muted opacity-60 [animation-iteration-count:3] motion-reduce:hidden" />
              )}
              <span
                className={cx(
                  "relative inline-flex h-1.5 w-1.5 rounded-full",
                  status.key === "in_progress" ? "bg-ink" : status.key === "exported" ? "bg-red-deep" : status.key === "closed_early" ? "border border-muted" : "bg-muted",
                )}
              />
            </span>
          )}
          {status.label}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/* ------------------------------------------------------------- close dialog */

/**
 * Confirm step for closing an activity, with an optional note. Native <dialog> + showModal(): the page
 * behind is inert, Tab stays inside, Esc cancels, and focus returns to whatever opened it.
 */
export function CloseActivityDialog({
  activity,
  open,
  onClose,
  fallbackFocus,
}: {
  activity: Pick<ActivityView, "id" | "title" | "kindLabel" | "exportedAt" | "kind">;
  open: boolean;
  onClose: () => void;
  /** Where focus goes after a successful close when the opener moves away (a sidebar thread jumps to the Closed group). */
  fallbackFocus?: () => HTMLElement | null | undefined;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const fetcher = useFetcher<{ activity?: ActivityView }>();
  const titleId = useId();
  const descId = useId();
  const noteId = useId();
  const [returnTo, setReturnTo] = useState<HTMLElement | null>(null);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setReturnTo(document.activeElement as HTMLElement | null);
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  // All exits go through dialog.close(), whose "close" event restores focus and tells the parent.
  const dismiss = () => ref.current?.close();
  const done = useRef(false);
  // Close once the action has landed.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.activity?.lifecycle === "closed") {
      done.current = true;
      ref.current?.close();
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descId}
      onClose={() => {
        onClose();
        // Cancel returns focus to the opener. After a close the opener may be on its way out (the thread's
        // exit animation still holds it in the DOM), so use the fallback when there is one.
        const target = done.current && fallbackFocus ? fallbackFocus() : returnTo?.isConnected ? returnTo : null;
        (target ?? document.getElementById("main"))?.focus();
      }}
      className="m-auto w-[420px] max-w-[calc(100vw-32px)] rounded-2xl border border-line bg-white p-0 text-ink shadow-[0_24px_64px_rgba(0,0,0,0.16)] backdrop:bg-black/20 open:transition-[opacity,scale] open:duration-150 open:ease-out starting:open:scale-[0.98] starting:open:opacity-0 motion-reduce:starting:open:scale-100"
    >
      <fetcher.Form method="post" action={`/activities/${activity.id}`} className="flex flex-col gap-4 p-6">
        <input type="hidden" name="intent" value="close" />
        <div className="flex flex-col gap-1.5">
          <h2 id={titleId} className="text-lg font-semibold leading-6 tracking-[-0.01em] text-ink">
            {activity.kind === "survey" ? "Close this survey?" : "Close this activity?"}
          </h2>
          <p id={descId} className="text-pretty text-[13px] leading-[19px] text-subtle">
            {activity.kind === "survey" ? (
              <>{activity.title}. Responses freeze and the survey is marked Completed. You can send a new wave from Surveys.</>
            ) : (
              <>
                {activity.title} · {activity.kindLabel}. Closing keeps everything you did, and you can reopen it anytime.
                {!activity.exportedAt && " Nothing has been exported yet, so it will be marked “Closed early”."}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={noteId} className="text-xs font-medium leading-4 text-ink">
            Note <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id={noteId}
            name="note"
            rows={3}
            maxLength={500}
            placeholder="Why are you closing it?"
            className="resize-none rounded-lg border border-control px-3 py-2 text-[13px] leading-[19px] text-ink outline-none placeholder:text-muted focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink"
          />
        </div>
        {fetcher.data && !fetcher.data.activity && (
          <p role="alert" className="text-xs text-red-deep">
            Couldn’t close the activity. Try again.
          </p>
        )}
        <div className="flex justify-end gap-2">
          {/* showModal() focuses the note field first: closing is reversible, so typing a note is the likely next step. */}
          <Button tone="outline" onClick={dismiss}>
            Cancel
          </Button>
          <Button tone="ink" type="submit" disabled={busy}>
            {busy ? "Closing…" : activity.kind === "survey" ? "Close survey" : "Close activity"}
          </Button>
        </div>
      </fetcher.Form>
    </dialog>
  );
}

/* ------------------------------------------------------------- sidebar threads */

/**
 * Kind glyph: distinct shapes (not just color) so the four kinds read apart at a glance; the kind name is
 * always on the thread's second line too.
 */
export function KindGlyph({ kind, className }: { kind: Kind; className?: string }) {
  const common = { width: 12, height: 12, viewBox: "0 0 12 12", fill: "none", "aria-hidden": true as const, className: cx("shrink-0 text-subtle", className) };
  switch (kind) {
    case "review": // magnifier: analysing a program
      return (
        <svg {...common}>
          <circle cx="5" cy="5" r="3.25" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7.5 7.5L10.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "outcomes": // bars: a story told with numbers
      return (
        <svg {...common}>
          <path d="M2 10.5V7M6 10.5V3.5M10 10.5V5.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      );
    case "survey": // speech bubble: asking people
      return (
        <svg {...common}>
          <path d="M2 2.75h8v5.5H5.5L3 10.25V8.25H2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      );
    default: // circular arrows: a sync run
      return (
        <svg {...common}>
          <path d="M10 6a4 4 0 01-7.2 2.4M2 6a4 4 0 017.2-2.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M9.6 1.5v2.3H7.3M2.4 10.5V8.2h2.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}

function Thread({ t, now, active, onRequestClose, closing }: { t: ActivityView; now: number; active: boolean; onRequestClose: (t: ActivityView) => void; closing: boolean }) {
  const fetcher = useFetcher();
  const [menuOpen, setMenuOpen] = useState(false);
  const closed = t.lifecycle === "closed";
  const post = (intent: string) => fetcher.submit({ intent }, { method: "post", action: actionFor(t.id) });
  const descId = `thread-${t.id}-desc`;
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.25, ease } }}
      exit={{ opacity: 0, transition: { duration: 0.15, ease: "easeOut" } }}
      transition={{ layout: { type: "spring", duration: 0.35, bounce: 0 } }}
      className="group/thread relative"
    >
      <Link
        to={t.path}
        aria-current={active ? "page" : undefined}
        aria-describedby={descId}
        className={cx(
          "flex flex-col gap-0.5 rounded-md py-[7px] pl-2 pr-8 transition-colors duration-150 hover:bg-surface/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink",
          active && "bg-surface",
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <KindGlyph kind={t.kind} />
          <span className={cx("truncate text-[13px] leading-4", closed ? "text-subtle" : "font-medium text-ink")} title={t.title}>
            {t.title}
          </span>
        </span>
        <span id={descId} className="flex min-w-0 items-center gap-1.5 pl-[18px] text-[11px] leading-[14px] text-muted">
          <span className="truncate">{t.kindLabel}</span>
          <span aria-hidden>·</span>
          <StatusLabel status={t.status} />
          <span aria-hidden>·</span>
          <time dateTime={t.updatedAt} className="shrink-0 tabular-nums">
            <span aria-hidden>{ago(t.updatedAt, now)}</span>
            <span className="sr-only">updated {longAgo(t.updatedAt, now)}</span>
          </time>
        </span>
        {t.needsReview && !closed && <span className="text-[11px] font-medium leading-[14px] text-red-deep">Data updated — review again</span>}
      </Link>
      <div className={cx("absolute right-1 top-1.5 transition-opacity duration-150", menuOpen || closing ? "opacity-100" : "opacity-0 group-hover/thread:opacity-100 group-focus-within/thread:opacity-100")}>
        <MenuButton
          label={`Actions for ${t.title}, ${t.kindLabel}`}
          onOpenChange={setMenuOpen}
          className={(open) =>
            cx(
              "relative flex h-6 w-6 items-center justify-center rounded-md text-subtle transition-[background-color,color,scale] duration-150 ease-out after:absolute after:-inset-1 after:content-[''] hover:bg-line hover:text-ink active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-ink",
              open && "bg-line text-ink",
            )
          }
          items={[
            { type: "link", label: "Open", to: t.path },
            // Syncs finish on their own; a closed survey is sent again as a new wave from Surveys.
            ...(t.kind === "sync"
              ? []
              : closed
                ? isAnalysis(t.kind)
                  ? [{ type: "separator" as const }, { type: "action" as const, label: "Reopen", onSelect: () => post("reopen") }]
                  : []
                : [{ type: "separator" as const }, { type: "action" as const, label: t.kind === "survey" ? "Close survey…" : "Close activity…", onSelect: () => onRequestClose(t) }]),
            ...(t.needsReview && !closed ? [{ type: "action" as const, label: "Mark data reviewed", onSelect: () => post("ack") }] : []),
          ]}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden fill="currentColor">
            <circle cx="3" cy="7" r="1.2" />
            <circle cx="7" cy="7" r="1.2" />
            <circle cx="11" cy="7" r="1.2" />
          </svg>
        </MenuButton>
      </div>
    </motion.li>
  );
}

/** The sidebar's Activities section: live threads first (newest activity on top), closed ones collapsed below. */
export function ActivityThreads({ threads, now }: { threads: ActivityView[]; now: number }) {
  const { pathname } = useLocation();
  const live = threads.filter((t) => t.lifecycle !== "closed");
  const closed = threads.filter((t) => t.lifecycle === "closed");
  const [showClosed, setShowClosed] = useState(false);
  // Finished syncs and surveys pile up: show the newest 20 closed threads until asked for all.
  const [allClosed, setAllClosed] = useState(false);
  const closedShown = allClosed ? closed : closed.slice(0, 20);
  const isActive = (t: ActivityView) => pathname === `/a/${t.id}` || pathname.startsWith(`/a/${t.id}/`);
  const closedId = useId();
  // One dialog for the list: a thread that gets closed moves to the Closed group (remounting), so the
  // dialog can't live inside it. Focus then lands on the Closed disclosure.
  const [closing, setClosing] = useState<ActivityView | null>(null);
  const closedButton = useRef<HTMLButtonElement>(null);
  const done = useCallback(() => setClosing(null), []);
  return (
    <div role="group" aria-labelledby="nav-activities" className="flex min-h-0 flex-col gap-0.5">
      <div className="flex items-baseline justify-between px-2 pb-2">
        <div id="nav-activities" className="label text-muted">
          Activities
        </div>
        {live.length > 0 && (
          <div className="font-mono text-[11px] tabular-nums text-muted">
            <span aria-hidden>{live.length}</span>
            <span className="sr-only">{live.length} open</span>
          </div>
        )}
      </div>
      <LayoutGroup>
        {live.length === 0 && (
          <p className="px-2 py-1 text-xs leading-[17px] text-muted">No open activities. Start a review or an outcomes story from a program.</p>
        )}
        <ul className="flex flex-col gap-0.5">
          <AnimatePresence initial={false} mode="popLayout">
            {live.map((t) => (
              <Thread key={t.id} t={t} now={now} active={isActive(t)} onRequestClose={setClosing} closing={closing?.id === t.id} />
            ))}
          </AnimatePresence>
        </ul>
        {closed.length > 0 && (
          <motion.div layout="position" className="mt-2 flex flex-col gap-0.5">
            <button
              ref={closedButton}
              type="button"
              aria-expanded={showClosed}
              aria-controls={closedId}
              onClick={() => setShowClosed((s) => !s)}
              className="group/closed flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-subtle transition-colors duration-150 hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={cx("transition-[rotate] duration-200 ease-out", showClosed && "rotate-90")}>
                <path d="M3.5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Closed
              <span className="font-mono tabular-nums text-muted">{closed.length}</span>
            </button>
            <AnimatePresence initial={false}>
              {showClosed && (
                <motion.ul
                  id={closedId}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto", transition: { duration: 0.2, ease } }}
                  exit={{ opacity: 0, height: 0, transition: { duration: 0.15, ease: "easeOut" } }}
                  className="flex flex-col gap-0.5 overflow-hidden"
                >
                  <AnimatePresence initial={false} mode="popLayout">
                    {closedShown.map((t) => (
                      <Thread key={t.id} t={t} now={now} active={isActive(t)} onRequestClose={setClosing} closing={false} />
                    ))}
                  </AnimatePresence>
                  {closed.length > closedShown.length && (
                    <li>
                      <button
                        type="button"
                        onClick={() => setAllClosed(true)}
                        className="rounded-md px-2 py-1.5 text-xs text-subtle underline-offset-4 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink"
                      >
                        Show all {closed.length}
                      </button>
                    </li>
                  )}
                </motion.ul>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </LayoutGroup>
      {closing && <CloseActivityDialog activity={closing} open onClose={done} fallbackFocus={() => closedButton.current} />}
    </div>
  );
}

/* ------------------------------------------------------------- inside an activity */

/** Stage bar controls: Close activity (with confirm), or Reopen when viewing a closed one. */
export function ActivityBarActions({ activity }: { activity: ActivityView }) {
  const fetcher = useFetcher();
  const [confirm, setConfirm] = useState(false);
  const closed = activity.lifecycle === "closed";
  // Syncs finish on their own; closed surveys don't reopen (send a new wave from Surveys).
  if (activity.kind === "sync" || (closed && !isAnalysis(activity.kind))) return null;
  return (
    <>
      {closed ? (
        <fetcher.Form method="post" action={actionFor(activity.id)} data-reopen>
          <input type="hidden" name="intent" value="reopen" />
          <Button tone="outline" type="submit" disabled={fetcher.state !== "idle"}>
            Reopen
          </Button>
        </fetcher.Form>
      ) : (
        <Button tone="ghost" onClick={() => setConfirm(true)} aria-haspopup="dialog">
          {activity.kind === "survey" ? "Close survey" : "Close activity"}
        </Button>
      )}
      {/* Stays mounted across the switch to "Reopen", so it can close itself and hand focus to that button. */}
      <CloseActivityDialog
        activity={activity}
        open={confirm}
        onClose={() => setConfirm(false)}
        fallbackFocus={() => document.querySelector<HTMLElement>("[data-reopen] button")}
      />
    </>
  );
}

/** Read-only banner for a closed activity, or the "review again" notice after a sync flagged it. */
export function ActivityBanner({ activity, now }: { activity: ActivityView; now: number }) {
  const fetcher = useFetcher();
  let body: ReactNode = null;
  if (activity.lifecycle === "closed" && !isAnalysis(activity.kind)) {
    body = null; // survey and sync pages say how they finished themselves
  } else if (activity.lifecycle === "closed") {
    const how =
      activity.closeReason === "sync"
        ? activity.closeNote ?? "Closed by sync: data updated and corrected."
        : `Closed ${activity.closedAt ? longAgo(activity.closedAt, now) : ""}${activity.exportedAt ? "" : ", before anything was exported"}.${activity.closeNote ? ` Note: “${activity.closeNote}”` : ""}`;
    body = (
      <>
        <span className="font-medium text-ink">Read-only.</span> <span>{how}</span> <span className="text-muted">Reopen it to keep working.</span>
      </>
    );
  } else if (activity.needsReview) {
    body = (
      <>
        <span className="font-medium text-red-deep">Data updated — review again.</span>{" "}
        <span>
          A sync changed this program’s data, but {activity.issues.length === 1 ? "an issue remains" : `${activity.issues.length} issues remain`}:{" "}
          {activity.issues.map((i) => i.label).join("; ")}.
        </span>{" "}
        <fetcher.Form method="post" action={actionFor(activity.id)} className="inline">
          <input type="hidden" name="intent" value="ack" />
          <button type="submit" className="rounded-sm font-medium text-ink underline underline-offset-4 hover:text-red-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
            Mark as reviewed
          </button>
        </fetcher.Form>
      </>
    );
  }
  return (
    <AnimatePresence initial={false}>
      {body && (
        <motion.div
          key={activity.lifecycle + String(activity.needsReview)}
          role="status"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto", transition: { duration: 0.2, ease } }}
          exit={{ opacity: 0, height: 0, transition: { duration: 0.15, ease: "easeOut" } }}
          className="overflow-hidden"
        >
          <div className={cx("rounded-lg px-3.5 py-2.5 text-xs leading-[17px] text-subtle", activity.needsReview && activity.lifecycle !== "closed" ? "bg-red-soft" : "bg-surface")}>
            {body}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export { shortDate };

/* ------------------------------------------------------------- setup */

const SETUP_STEPS: Record<string, string> = { connect: "Connect sources", sync: "Sync & check", surveys: "Fill gaps with surveys", done: "Done" };

/** Sidebar row until workspace setup is completed: resumes it, or can be dismissed (Integrations keeps "Re-run setup"). */
export function FinishSetup({ step }: { step: string }) {
  const fetcher = useFetcher();
  const n = Object.keys(SETUP_STEPS).indexOf(step) + 1 || 1;
  if (fetcher.state !== "idle" || fetcher.data) return null;
  return (
    <div className="mb-4 flex items-start gap-2 rounded-[10px] border border-line p-3">
      <Link to="/onboarding" className="flex min-w-0 grow flex-col gap-0.5 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
        <span className="text-[13px] font-medium text-ink">Finish setup →</span>
        <span className="text-[11px] leading-[14px] text-muted">
          Step {n} of 4 · {SETUP_STEPS[step] ?? "Connect sources"}
        </span>
      </Link>
      <fetcher.Form method="post" action="/onboarding">
        <input type="hidden" name="intent" value="dismiss" />
        <button
          type="submit"
          aria-label="Dismiss setup reminder"
          className="relative flex h-5 w-5 items-center justify-center rounded text-muted after:absolute after:-inset-1 after:content-[''] hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </fetcher.Form>
    </div>
  );
}

/* ------------------------------------------------------------- in-review survey nudge */

/**
 * Contextual "Survey them" inside a review (replaces the old survey stage). Sends the program's alumni survey
 * through POST /activities/new kind=survey (linked to this review) without leaving the page; the survey becomes
 * its own activity. Once out, it links to that thread. Response counts are simulated (demo).
 */
export function SurveyNudge({
  programId,
  unknown,
  survey,
  className,
}: {
  programId: string;
  unknown: number;
  survey: { threadId: string | null; recipients: number; responses: number } | null;
  className?: string;
}) {
  const activity = useActivity();
  const fetcher = useFetcher<{ activity?: ActivityView; error?: string }>();
  const sent = fetcher.data?.activity;
  const [toastOpen, setToastOpen] = useState(true);
  // One click sends the survey as its own activity; the review stays put and a toast links to the new thread.
  // The toast carries an action, so it stays until dismissed.
  const toast = (
    <div role="status" className="pointer-events-none fixed bottom-6 right-6 z-40">
      <AnimatePresence initial={false}>
        {sent && toastOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.25, ease } }}
            exit={{ opacity: 0, transition: { duration: 0.15, ease: "easeOut" } }}
            className="pointer-events-auto flex items-center gap-3 rounded-xl bg-ink px-4 py-3 text-[13px] text-white shadow-[0_12px_32px_rgba(0,0,0,0.2)]"
          >
            <span>
              <span aria-hidden>✓ </span>Alumni survey sent · {sent.title}
            </span>
            <Link to={sent.path} className="font-medium underline underline-offset-4 hover:text-line">
              Open survey
            </Link>
            <button
              type="button"
              onClick={() => setToastOpen(false)}
              aria-label="Dismiss"
              className="relative ml-1 flex h-5 w-5 items-center justify-center rounded text-white/70 after:absolute after:-inset-1 after:content-[''] hover:text-white focus-visible:outline-2 focus-visible:outline-white"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
  if (!unknown && !survey) return toast;
  const box = cx("flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-surface px-4 py-2.5 text-[13px] leading-5 text-text", className);
  if (survey || sent) {
    const thread = survey?.threadId ? `/a/${survey.threadId}/survey` : sent?.path;
    return (
      <>
      {toast}
      <div className={box}>
        <span>
          Alumni survey out{survey ? ` · ${survey.responses}/${survey.recipients} answered` : ""} <span className="text-muted">(demo responses)</span>
        </span>
        {thread && (
          <Link to={thread} className="font-medium text-ink underline underline-offset-4 hover:text-red-deep">
            Open survey activity
          </Link>
        )}
      </div>
      </>
    );
  }
  return (
    <fetcher.Form method="post" action="/activities/new" className={box}>
      <input type="hidden" name="programId" value={programId} />
      <input type="hidden" name="kind" value="survey" />
      <input type="hidden" name="audience" value="alumni" />
      <input type="hidden" name="stay" value="1" />
      {activity && <input type="hidden" name="from" value={activity.id} />}
      <span>
        <span className="font-medium text-red-deep">{unknown.toLocaleString()}</span> alumni have no job on record.
      </span>
      <button
        type="submit"
        disabled={fetcher.state !== "idle" || activity?.lifecycle === "closed"}
        className="rounded-sm font-medium text-ink underline underline-offset-4 hover:text-red-deep focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-60"
      >
        {fetcher.state !== "idle" ? "Sending…" : "Survey them"}
      </button>
      {fetcher.data?.error && <span className="text-red-deep">{fetcher.data.error}</span>}
    </fetcher.Form>
  );
}
