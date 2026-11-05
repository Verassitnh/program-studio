import { Link, useFetcher, useFetchers } from "react-router";
import { ActivityMenu, type Entry } from "./activity-menu";
import { cx } from "~/components/ui";
import { Spinner, StatusLine } from "~/components/workspace/kit";
import { KIND_META, fmtDay, kindMeta, openLabel, plural, type ActivityKind, type ActivityRef, type Audience, type ProgramRow } from "./model";

/* ------------------------------------------------------------------ icons */

/** One glyph per activity kind (stroke follows the text color), so kinds read at a glance beside status labels. */
export function KindIcon({ kind, className }: { kind: string; className?: string }) {
  const p = { stroke: "currentColor", strokeWidth: 1.4, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className={cx("shrink-0", className)}>
      {kind === "review" ? (
        <>
          <circle cx="5.25" cy="5.25" r="3.25" {...p} />
          <path d="M7.75 7.75L10.5 10.5" {...p} />
        </>
      ) : kind === "outcomes" ? (
        <path d="M1.5 10.5h9M3 8V6M6 8V3.5M9 8V5" {...p} />
      ) : kind === "survey" ? (
        <path d="M2 2.5h8v5.5H5L2.5 10V8H2z" {...p} />
      ) : (
        <path d="M10 4.5A4 4 0 002.6 3.4M2 7.5a4 4 0 007.4 1.1M2.4 1.5v2h2M9.6 10.5v-2h-2" {...p} />
      )}
    </svg>
  );
}

/* --------------------------------------------------------------- starting */

type StartResult = { error?: string } | undefined;
const START = "/activities/new";

/**
 * Starts work with a POST to /activities/new (it resumes the open activity of that kind, or opens a new one)
 * through a fetcher keyed per program, so the row and the slide-over share one pending state. A redirect
 * moves into the activity; an error response stays here and is shown inline.
 */
export function useStartActivity(programId: string) {
  const fetcher = useFetcher<StartResult>({ key: `start-${programId}` });
  const start = (kind: ActivityKind, audience?: Audience) =>
    fetcher.submit({ programId, kind, ...(audience ? { audience } : {}) }, { method: "post", action: START });
  const busy = fetcher.state !== "idle";
  const kind = (fetcher.formData?.get("kind") as string | null) ?? null;
  const error = !busy && fetcher.data && typeof fetcher.data === "object" && "error" in fetcher.data ? String(fetcher.data.error) : null;
  return { start, busy, kind, error };
}

/** Whichever program is starting an activity right now (for the page's live announcement). */
export function usePendingStart() {
  const f = useFetchers().find((x) => x.key.startsWith("start-") && x.state !== "idle");
  return f ? { programId: f.key.slice("start-".length), kind: (f.formData?.get("kind") as string | null) ?? null } : null;
}

/* ------------------------------------------------------------------ menu */

const pill = "inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap text-xs font-medium transition-[background-color,border-color,color,scale] duration-150 ease-out active:scale-[0.96]";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={cx("transition-[rotate] duration-200 ease-out", open && "rotate-180")}>
      <path d="M2.5 3.75L5 6.25l2.5-2.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const icon = (kind: string) => <KindIcon kind={kind} className="text-subtle" />;

/** What each create option does, in the words the menu shows. */
const DOES: Record<"review" | "outcomes", string> = { review: "Explore → board packet", outcomes: "Opens the report" };

/**
 * Create options: Program review and Outcomes story (unless one is open), then a survey per audience.
 * A survey sends immediately, so it asks "Send now?" first. An audience with nobody to reach is disabled, with the reason.
 */
function createEntries(row: ProgramRow, start: (k: ActivityKind, a?: Audience) => void, skip: ActivityKind[]): Entry[] {
  const kinds = (["review", "outcomes"] as const).filter((k) => !skip.includes(k));
  const r = row.reach;
  const survey = (audience: Audience, n: number, noun: [string, string], extra: string): Entry => ({
    type: "action",
    key: `survey-${audience}`,
    icon: icon("survey"),
    label: audience === "alumni" ? "Send alumni survey" : "Send employer survey",
    hint: `${plural(n, "recipient", "recipients")}${extra} · sends now`,
    disabled: !r.surveyable
      ? "Surveys cover School of Business programs only"
      : n === 0
        ? audience === "alumni"
          ? "No alumni emails on file"
          : "No employers on record"
        : undefined,
    confirm: { label: "Send now?", hint: `Select again to send to ${plural(n, noun[0], noun[1])}. It goes out immediately.` },
    onSelect: () => start("survey", audience),
  });
  return [
    ...kinds.map((k): Entry => ({ type: "action", key: k, icon: icon(k), label: skip.length ? `New ${KIND_META[k].label.toLowerCase()}` : KIND_META[k].label, hint: DOES[k], onSelect: () => start(k) })),
    ...(kinds.length ? [{ type: "separator" as const, key: "sep-survey" }] : []),
    survey("alumni", r.alumni, ["alumnus", "alumni"], r.unknownJobs ? ` · fills up to ${plural(r.unknownJobs, "unknown job", "unknown jobs")}` : ""),
    survey("employers", r.employers, ["employer", "employers"], ""),
  ];
}

const others = (row: ProgramRow, primary: ActivityRef): Entry[] =>
  row.liveAll.filter((a) => a.id !== primary.id).map((a) => ({ type: "link", key: a.id, icon: icon(a.kind), label: openLabel(a.kind), to: a.path, hint: a.status.label }));

/**
 * The row's next step.
 *   Live activity   "Open review →" for the most recent live one; a menu lists the other live ones and the create options
 *   None            "Create activity" menu: Program review / Outcomes story / Send a survey (Alumni, Employers)
 *   Only closed     the same menu, plus a subtle "Last closed <date>" link to the latest closed one
 */
export function NextStep({ row, size = "sm" }: { row: ProgramRow; size?: "sm" | "md" }) {
  const { start, busy, kind, error } = useStartActivity(row.id);
  const h = size === "md" ? "h-9 text-[13px]" : "";

  let control;
  if (busy) {
    control = (
      <span className={cx(pill, h, "cursor-progress rounded-full border border-line px-3 text-subtle")}>
        <Spinner />
        {kind === "survey" ? "Sending survey…" : `Opening ${kind === "outcomes" ? "story" : "review"}…`}
      </span>
    );
  } else if (row.live) {
    const live = row.live;
    const rest = others(row, live);
    const entries: Entry[] = [
      ...(rest.length ? [{ type: "heading" as const, key: "h-open", label: "Also open" }, ...rest, { type: "separator" as const, key: "sep-open" }] : []),
      ...createEntries(row, start, row.liveAll.map((a) => a.kind)),
    ];
    control = (
      <span className="inline-flex items-stretch">
        <Link
          to={live.path}
          prefetch="intent"
          aria-label={`${openLabel(live.kind)}: ${row.name}, ${live.status.label}`}
          className={cx(pill, h, "rounded-l-full bg-ink pl-3 pr-2.5 text-white hover:bg-ink-hover")}
        >
          {openLabel(live.kind)}
          <span aria-hidden>→</span>
        </Link>
        <ActivityMenu
          label={`More activities for ${row.name}${rest.length ? `, ${rest.length} more open` : ""}`}
          entries={entries}
          className={(open) => cx(pill, h, "rounded-r-full border-l border-white/25 bg-ink px-2 text-white hover:bg-ink-hover", open && "bg-ink-hover")}
        >
          {(open) => (
            <>
              {rest.length > 0 && <span className="font-mono text-[11px] tabular-nums text-white/75">+{rest.length}</span>}
              <Chevron open={open} />
            </>
          )}
        </ActivityMenu>
      </span>
    );
  } else {
    control = (
      <ActivityMenu
        label={`Create activity for ${row.name}`}
        entries={createEntries(row, start, [])}
        className={(open) => cx(pill, h, "rounded-full border bg-white px-3 text-ink hover:border-ink", open ? "border-ink" : "border-line")}
      >
        {(open) => (
          <>
            Create activity
            <Chevron open={open} />
          </>
        )}
      </ActivityMenu>
    );
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      {control}
      {!row.live && row.lastClosed && !error && (
        <Link
          to={row.lastClosed.path}
          className="rounded-sm text-[11px] leading-4 text-muted underline decoration-line-hover underline-offset-2 transition-colors duration-150 hover:text-ink hover:decoration-ink"
        >
          Last closed {fmtDay(row.lastClosed.closedAt ?? row.lastClosed.updatedAt)}
          <span className="sr-only">: {kindMeta(row.lastClosed.kind).label}</span>
        </Link>
      )}
      <StatusLine tone="error" className="max-w-[220px] text-right text-[11px]! leading-[14px]!" message={error ? `Couldn’t start: ${error}` : null} />
    </span>
  );
}
