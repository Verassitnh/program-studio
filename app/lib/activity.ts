// Client-safe activity metadata shared by loaders, the sidebar threads and the stage bars.
// (Anything that touches the database lives in activities.server.ts.)

/** Dates render in the institution's time zone on server and client alike (no hydration drift). */
const TZ = "America/Los_Angeles";

export type Kind = "review" | "outcomes" | "survey" | "sync";
/** Kinds that analyse one program through navigable stages. */
export type AnalysisKind = "review" | "outcomes";
export type Lifecycle = "open" | "running" | "closed";
export type StatusKey = "collecting" | "in_progress" | "exported" | "completed" | "closed_early" | "failed";
export type ActivityStatus = { key: StatusKey; label: string };
export type Issue = { key: string; label: string; count: number };

/**
 * An activity is any action the dean takes, as a thread with a finish:
 *   review    Explore → Diagnose → Build → Packet (progress bar)
 *   outcomes  Story → Dig deeper → Fix → Export (progress bar; opens on the report itself)
 *   survey    single page: created by sending the survey; completes when the survey is closed
 *   sync      single page: created by running a sync; completes (or fails) when the run ends
 * Connecting sources, the first sync and the first gap surveys happen once, in workspace setup (/onboarding).
 */
export const KINDS: Record<Kind, { label: string; stages: string[] }> = {
  review: { label: "Program review", stages: ["explore", "diagnose", "build", "packet"] },
  outcomes: { label: "Outcomes story", stages: ["story", "deeper", "fix", "export"] },
  // Single-page kinds: `stage` only records where the record is (no navigation, no progress bar).
  survey: { label: "Survey", stages: ["responses", "closed"] },
  sync: { label: "Data sync", stages: ["run", "done"] },
};
export const KIND_ORDER: Kind[] = ["review", "outcomes", "survey", "sync"];
export const isAnalysis = (k: Kind): k is AnalysisKind => k === "review" || k === "outcomes";

/** Review stages that moved to onboarding; old links and activities parked there are redirected. */
export const RETIRED_STAGES = ["connect", "sync", "survey"];
/** Activities that are a single page (no stage progress): they act on creation and finish on their own. */
export const isSinglePage = (k: Kind) => k === "survey" || k === "sync";

/** Stage names as the stage bars show them (also used for page titles). */
export const STAGE_LABELS: Record<string, string> = {
  explore: "Explore",
  diagnose: "Diagnose",
  build: "Build changes",
  packet: "Board packet",
  story: "Story",
  deeper: "Dig deeper",
  fix: "Fix the story",
  export: "Export",
};

export const isKind = (k: unknown): k is Kind => k === "review" || k === "outcomes" || k === "survey" || k === "sync";
export const firstStage = (kind: Kind) => KINDS[kind].stages[0];
export const isStage = (kind: Kind, stage: unknown): stage is string => typeof stage === "string" && KINDS[kind].stages.includes(stage);

/** Where a thread opens: an analysis at its last visited stage; a survey or sync on its single page. */
export const activityPath = (a: { id: string; kind: Kind; stage: string }) => (isAnalysis(a.kind) ? `/a/${a.id}/${a.kind}/${a.stage}` : `/a/${a.id}/${a.kind}`);

/** What the sidebar and the activity layout get for each activity. */
export type ActivityView = {
  id: string;
  /** Null for syncs (workspace-level). */
  programId: string | null;
  /** studio.surveys.id for a survey, studio.syncs.id for a finished sync. */
  refId: string | null;
  kind: Kind;
  kindLabel: string;
  title: string;
  stage: string;
  lifecycle: Lifecycle;
  status: ActivityStatus;
  needsReview: boolean;
  issues: Issue[];
  openedAt: string;
  updatedAt: string;
  exportedAt: string | null;
  closedAt: string | null;
  closeReason: "manual" | "sync" | "finished" | "failed" | null;
  closeNote: string | null;
  state: Record<string, unknown>;
  path: string;
};

/** "now", "5m", "3h", "2d", or a date. `now` comes from the loader so server and client agree. */
export function ago(iso: string, now: number) {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ });
}

export const longAgo = (iso: string, now: number) => {
  const a = ago(iso, now);
  if (a === "now") return "just now";
  const m = /^(\d+)([mhd])$/.exec(a);
  if (!m) return `on ${a}`;
  const unit = { m: "minute", h: "hour", d: "day" }[m[2] as "m" | "h" | "d"];
  return `${m[1]} ${unit}${m[1] === "1" ? "" : "s"} ago`;
};

export const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: TZ });

/** "Management Analysts" → "analyst", "Public Relations Specialists" → "specialist" (for short copy like "analyst postings"). */
export function roleWord(occupation: string) {
  const last = occupation.trim().split(/\s+/).pop() ?? "";
  return last.toLowerCase().replace(/ies$/, "y").replace(/s$/, "");
}
