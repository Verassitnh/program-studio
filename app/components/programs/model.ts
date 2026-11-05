/*
 * Client-safe model for the Programs dashboard (/): row and detail types, column definitions, URL state,
 * filtering, sorting and formatting. app/lib/programs.server.ts fills these types from the database.
 */
import type { ActivityStatus } from "~/lib/activity";

/**
 * Activity kinds as the dashboard names them. Kept here (not read from KINDS) so rows render whichever
 * kinds the activities backend stores: review, outcomes, survey (per program) and sync (workspace-wide).
 */
export type ActivityKind = "review" | "outcomes" | "survey" | "sync";
export const KIND_META: Record<ActivityKind, { label: string; open: string; hint: string }> = {
  review: { label: "Program review", open: "Open review", hint: "Skills, alumni, changes" },
  outcomes: { label: "Outcomes story", open: "Open story", hint: "What the data supports" },
  survey: { label: "Survey", open: "Open survey", hint: "Ask alumni or employers" },
  sync: { label: "Data sync", open: "Open sync", hint: "" },
};
export const kindMeta = (k: string) => KIND_META[k as ActivityKind] ?? { label: k, open: "Open activity", hint: "" };
export type Audience = "alumni" | "employers";

export type Level = "bachelor" | "master" | "graduate-certificate";

export const LEVELS: { value: Level; label: string; short: string }[] = [
  { value: "bachelor", label: "Bachelor's", short: "Bachelor's" },
  { value: "master", label: "Master's", short: "Master's" },
  {
    value: "graduate-certificate",
    label: "Graduate certificate",
    short: "Grad cert.",
  },
];
export const levelLabel = (l: string) => LEVELS.find((x) => x.value === l)?.label ?? l;

/** An activity as the dashboard shows it (a slim ActivityView). */
export type ActivityRef = {
  id: string;
  kind: ActivityKind;
  kindLabel: string;
  stage: string;
  status: ActivityStatus;
  path: string;
  live: boolean;
  openedAt: string;
  updatedAt: string;
  closedAt: string | null;
};

export type Quality = "ok" | "small" | "none";

export type ProgramRow = {
  id: string;
  name: string;
  level: Level;
  cip: string;
  cipName: string;
  /** Two-digit CIP series, e.g. "52". */
  family: string;
  familyLabel: string;
  /** Highest King County 2024 alignment score, as a whole percent. */
  coverage: number | null;
  occupation: { code: string; name: string } | null;
  /** Every aligned occupation, highest score first (search matches these too). */
  occupations: string[];
  alumni: number;
  /** Alumni with a job on record. */
  known: number;
  inField: number;
  inFieldKnown: number;
  /** Alumni with no job on record. */
  unknown: number;
  ttjN: number;
  within6: number;
  medianMonths: number | null;
  /** Median annual salary on the current job, from salaries reported per year (hourly wages excluded). */
  medianWage: number | null;
  wageN: number;
  /** Alumni whose current wage is hourly (not annualized, so not in medianWage). */
  hourlyN: number;
  /** Survey audiences: alumni with an email on file, of them those with no job on record, and distinct employers of the program's grads. */
  reach: { alumni: number; unknownJobs: number; employers: number; /** Surveys run for School of Business programs only (workspace.server). */ surveyable: boolean };
  /** Unique postings for the top occupation in the demand region, latest period. */
  postings: number | null;
  /** Year-over-year change in postings for the top occupation in the demand region (0.025 = +2.5%). */
  growth: number | null;
  live: ActivityRef | null;
  /** Every non-closed activity, newest first. */
  liveAll: ActivityRef[];
  lastClosed: ActivityRef | null;
  quality: Quality;
};

export type Region = { code: string; name: string; postings: number };

export type Career = {
  code: string;
  name: string;
  /** King County 2024 alignment score, whole percent. */
  score: number | null;
  /** Listed in the program's target occupations (app.program_targets); otherwise aligned only. */
  target: boolean;
  /** Demand region, latest period. */
  postings: number | null;
  growth: number | null;
  /** Median advertised salary in postings, USD per year. */
  salary: number | null;
  trend: { period: string; postings: number }[];
  /** Alumni whose current job is in this occupation. */
  alumni: number;
  employers: { name: string; n: number }[];
  /** King County 2024 benchmark skills for the occupation. */
  bench: { total: number; taught: number; gaps: { id: string; name: string; weight: number; postings: number }[] };
};

export type ProgramDetail = {
  id: string;
  description: string | null;
  courses: number;
  /** Targets plus aligned occupations, highest alignment first. careers[0] is the primary one. */
  careers: Career[];
  /** Current occupations of alumni with a known job, most common first. */
  landings: { code: string | null; name: string; n: number }[];
  outcomes: { inField: number; outField: number; unknown: number; region: number; regionKnown: number };
  ttj: { n: number; within6: number; within12: number; over12: number; median: number | null };
  wage: { n: number; median: number | null; p25: number | null; p75: number | null; hourly: number };
  employers: { name: string; n: number }[];
  activities: ActivityRef[];
};

/* ------------------------------------------------------------------ columns */

export type ColumnKey = "activity" | "coverage" | "occupation" | "alumni" | "inField" | "hired6" | "months" | "wage" | "unknown" | "demand" | "quality" | "next";
export type SortKey = "name" | "activity" | "coverage" | "occupation" | "alumni" | "inField" | "hired6" | "months" | "wage" | "unknown" | "demand" | "quality";

export const COLUMNS: {
  head?: string;
  key: ColumnKey;
  label: string;
  sort?: SortKey;
  hideable: boolean;
  defaultOn: boolean;
  align?: "right";
  width: string;
  help?: string;
}[] = [
  {
    key: "activity",
    label: "Activity",
    sort: "activity",
    hideable: true,
    defaultOn: true,
    width: "w-[112px]",
    help: "The program's most recent open activity",
  },
  {
    key: "coverage",
    label: "Coverage",
    sort: "coverage",
    hideable: true,
    defaultOn: true,
    width: "w-[96px]",
    help: "Highest alignment score with an occupation, King County, 2024",
  },
  {
    key: "occupation",
    label: "Top occupation",
    sort: "occupation",
    hideable: true,
    defaultOn: true,
    width: "w-[132px]",
  },
  {
    key: "alumni",
    label: "Alumni",
    sort: "alumni",
    hideable: true,
    defaultOn: true,
    align: "right",
    width: "w-[66px]",
  },
  {
    key: "inField",
    label: "In field",
    sort: "inField",
    hideable: true,
    defaultOn: true,
    width: "w-[92px]",
    help: "Share of alumni with a known job who work in their field",
  },
  {
    key: "hired6",
    label: "Hired ≤ 6 mo",
    head: "Hired\n≤ 6 mo",
    sort: "hired6",
    hideable: true,
    defaultOn: true,
    align: "right",
    width: "w-[80px]",
    help: "Share of alumni whose first job started within 6 months of graduating",
  },
  {
    key: "months",
    label: "Months to job",
    sort: "months",
    hideable: true,
    defaultOn: false,
    align: "right",
    width: "w-[76px]",
    help: "Median months from graduation to first job",
  },
  {
    key: "wage",
    label: "Salary",
    sort: "wage",
    hideable: true,
    defaultOn: true,
    align: "right",
    width: "w-[66px]",
    help: "Median annual salary on the current job (hourly wages excluded)",
  },
  {
    key: "unknown",
    label: "Unknown",
    sort: "unknown",
    hideable: true,
    defaultOn: false,
    align: "right",
    width: "w-[72px]",
    help: "Alumni with no job on record",
  },
  {
    key: "demand",
    label: "Demand",
    sort: "demand",
    hideable: true,
    defaultOn: true,
    align: "right",
    width: "w-[80px]",
    help: "Postings for the top occupation in the demand region, 2024, and the change from 2023",
  },
  {
    key: "quality",
    label: "Data",
    sort: "quality",
    hideable: true,
    defaultOn: false,
    width: "w-[96px]",
    help: "Flags programs with too few alumni records to report rates",
  },
  {
    key: "next",
    label: "Next step",
    hideable: false,
    defaultOn: true,
    align: "right",
    width: "w-[136px]",
  },
];

/* ---------------------------------------------------------------- URL state */

export type ActivityFilter = "" | "live" | "none";
export type QualityFilter = "" | "ok" | "small";

export type TableState = {
  q: string;
  levels: Level[];
  families: string[];
  activity: ActivityFilter;
  quality: QualityFilter;
  sort: SortKey;
  dir: "asc" | "desc";
  group: boolean;
  cols: ColumnKey[];
};

export const DEFAULT_SORT: { sort: SortKey; dir: "asc" | "desc" } = {
  sort: "alumni",
  dir: "desc",
};
const DEFAULT_COLS = COLUMNS.filter((c) => c.defaultOn).map((c) => c.key);
const SORT_KEYS = new Set<string>(COLUMNS.flatMap((c) => (c.sort ? [c.sort] : [])).concat("name"));
const COL_KEYS = new Set<string>(COLUMNS.map((c) => c.key));
const list = (v: string | null) => (v ? v.split(",").filter(Boolean) : []);

export function readState(p: URLSearchParams): TableState {
  const sort = p.get("sort");
  const validSort = sort && SORT_KEYS.has(sort) ? (sort as SortKey) : DEFAULT_SORT.sort;
  const dir =
    p.get("dir") === "asc" || p.get("dir") === "desc" ? (p.get("dir") as "asc" | "desc") : sort && SORT_KEYS.has(sort) ? defaultDir(validSort) : DEFAULT_SORT.dir;
  const cols = p.has("cols") ? list(p.get("cols")).filter((c): c is ColumnKey => COL_KEYS.has(c)) : DEFAULT_COLS;
  return {
    q: p.get("q") ?? "",
    levels: list(p.get("level")).filter((l): l is Level => LEVELS.some((x) => x.value === l)),
    families: list(p.get("family")),
    activity: (["live", "none"].includes(p.get("activity") ?? "") ? p.get("activity") : "") as ActivityFilter,
    quality: (["ok", "small"].includes(p.get("quality") ?? "") ? p.get("quality") : "") as QualityFilter,
    sort: validSort,
    dir,
    group: p.get("group") === "family",
    cols: [...new Set([...cols, "next" as ColumnKey])],
  };
}

/** Text columns sort A→Z first; numbers sort high→low first. */
export const defaultDir = (s: SortKey): "asc" | "desc" => (s === "name" || s === "occupation" || s === "months" || s === "quality" ? "asc" : "desc");

/** URL patch for a state change (null removes the param). Defaults are left out so the URL stays short. */
export function patchFor(next: Partial<TableState>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  if ("q" in next) out.q = next.q?.trim() ? next.q : null;
  if ("levels" in next) out.level = next.levels?.length ? next.levels.join(",") : null;
  if ("families" in next) out.family = next.families?.length ? next.families.join(",") : null;
  if ("activity" in next) out.activity = next.activity || null;
  if ("quality" in next) out.quality = next.quality || null;
  if ("sort" in next || "dir" in next) {
    const isDefault = next.sort === DEFAULT_SORT.sort && next.dir === DEFAULT_SORT.dir;
    out.sort = isDefault ? null : (next.sort ?? null);
    out.dir = isDefault || next.dir === defaultDir(next.sort ?? DEFAULT_SORT.sort) ? null : (next.dir ?? null);
  }
  if ("group" in next) out.group = next.group ? "family" : null;
  if ("cols" in next) {
    const cols = (next.cols ?? []).filter((c) => c !== "next");
    const same = cols.length === DEFAULT_COLS.length - 1 && cols.every((c) => DEFAULT_COLS.includes(c));
    out.cols = same ? null : cols.join(",") || "none";
  }
  return out;
}

/* ----------------------------------------------------------- filter + sort */

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function matches(r: ProgramRow, s: TableState) {
  if (s.levels.length && !s.levels.includes(r.level)) return false;
  if (s.families.length && !s.families.includes(r.family)) return false;
  if (s.activity === "live" && !r.live) return false;
  if (s.activity === "none" && r.live) return false;
  if (s.quality === "ok" && r.quality !== "ok") return false;
  if (s.quality === "small" && r.quality === "ok") return false;
  const q = norm(s.q.trim());
  if (!q) return true;
  const hay = norm([r.name, r.cip, r.cipName, r.familyLabel, levelLabel(r.level), ...r.occupations].join(" · "));
  return q.split(/\s+/).every((t) => hay.includes(t));
}

/** Rate shown in the table, or null when the base is too small to report (smallN) or empty. */
export const rate = (num: number, den: number, smallN: number) => (den >= smallN && den > 0 ? Math.round((100 * num) / den) : null);

const STATUS_ORDER: Record<string, number> = {
  in_progress: 0,
  collecting: 1,
  exported: 2,
};

export function sortValue(r: ProgramRow, key: SortKey, smallN: number): number | string | null {
  switch (key) {
    case "name":
      return r.name;
    case "activity":
      return r.live ? (STATUS_ORDER[r.live.status.key] ?? 3) : null;
    case "coverage":
      return r.coverage;
    case "occupation":
      return r.occupation?.name ?? null;
    case "alumni":
      return r.alumni;
    case "inField":
      return rate(r.inField, r.inFieldKnown, smallN);
    case "hired6":
      return rate(r.within6, r.ttjN, smallN);
    case "months":
      return r.ttjN >= smallN ? r.medianMonths : null;
    case "wage":
      return r.wageN >= smallN ? r.medianWage : null;
    case "unknown":
      return r.alumni ? r.unknown : null;
    case "demand":
      return r.postings;
    case "quality":
      return { none: 2, small: 1, ok: 0 }[r.quality];
  }
}

/** Sorts a copy. Missing values always sink to the bottom, whichever the direction; ties fall back to name. */
export function sortRows(rows: ProgramRow[], s: TableState, smallN: number) {
  const sign = s.dir === "asc" ? 1 : -1;
  // Activity sorts by status order ascending, so "desc" (the first click) should put live work on top.
  const flip = s.sort === "activity" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, s.sort, smallN);
    const vb = sortValue(b, s.sort, smallN);
    if (va == null && vb != null) return 1;
    if (vb == null && va != null) return -1;
    if (va != null && vb != null && va !== vb) {
      const c = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return c * sign * flip;
    }
    return a.name.localeCompare(b.name);
  });
}

/* ----------------------------------------------------------------- summary */

export const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function summarize(rows: ProgramRow[]) {
  const sum = (f: (r: ProgramRow) => number) => rows.reduce((t, r) => t + f(r), 0);
  const inField = sum((r) => r.inField);
  const inFieldKnown = sum((r) => r.inFieldKnown);
  return {
    programs: rows.length,
    alumni: sum((r) => r.alumni),
    known: sum((r) => r.known),
    coverage: median(rows.flatMap((r) => (r.coverage == null ? [] : [r.coverage]))),
    inField,
    inFieldKnown,
    inFieldPct: inFieldKnown ? Math.round((100 * inField) / inFieldKnown) : null,
    live: rows.filter((r) => r.live).length,
  };
}

/* ------------------------------------------------------------------ format */

const TZ = "America/Los_Angeles";
const nf = new Intl.NumberFormat("en-US");
const df = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: TZ,
});
const dfy = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: TZ,
});
const pr = new Intl.PluralRules("en-US");

export const fmtNum = (v: number | null | undefined) => (v == null ? "—" : nf.format(v));
export const fmtK = (v: number | null | undefined) => (v == null ? "—" : `$${Math.round(v / 1000)}k`);
export const fmtMoney = (v: number | null | undefined) => (v == null ? "—" : `$${nf.format(Math.round(v / 100) * 100)}`);
export const fmtGrowth = (g: number | null | undefined) => (g == null ? "—" : `${g > 0 ? "+" : g < 0 ? "−" : "±"}${Math.abs(Math.round(g * 1000) / 10).toFixed(1)}%`);
export const fmtDay = (iso: string) => df.format(new Date(iso));
export const fmtDate = (iso: string) => dfy.format(new Date(iso));
export const plural = (n: number, one: string, other: string) => `${nf.format(n)} ${pr.select(n) === "one" ? one : other}`;

/** "Open review", "Open story", "Open survey". */
export const openLabel = (k: string) => kindMeta(k).open;
