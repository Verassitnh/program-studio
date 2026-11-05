/**
 * Workspace data: Surveys, Integrations, Exports and Account settings (the /surveys, /integrations,
 * /exports and /account pages). Owns the tables in db/studio-workspace.sql, which this module applies
 * lazily, once per process, before its first query. The activities agent's tables (studio.activities,
 * studio.activity_events, studio.syncs from db/studio.sql) are read only, and every read is guarded by a
 * "table exists" check so the pages degrade to empty states.
 *
 * ── Survey API ───────────────────────────────────────────────────────────────────────────────────────
 *   Lives in ./surveys.server.ts (questions, recipients and private links, responses, results, corrections)
 *   and is re-exported below, so imports from this module keep working: listSurveys, getSurvey,
 *   surveyForProgram, createSurvey, sendSurvey, scheduleSurvey, unscheduleSurvey, remindSurvey, closeSurvey,
 *   duplicateSurvey, deleteDraft, createDraftsForUnknownOutcomes, surveysPage, …
 *
 * ── Settings ─────────────────────────────────────────────────────────────────────────────────────────
 *   getSettings() → { smallN, region, regionName }; saveSettings({ smallN?, region? })
 */
import schemaSql from "../../db/studio-workspace.sql?raw";
import { activityStatus } from "./activities.server";
import { KINDS, activityPath, type Kind } from "./activity";
import { one, q } from "./db.server";

export const INSTITUTION = "north-sound-state";
/** The School of Business: the programs the dashboard lists. */
export const SCHOOL = `p.institution_id = '${INSTITUTION}' and p.cip_code like '52.%'`;
const PERIOD = "2024-01";
const DATA_AS_OF = "2025-12-31";

/* ----------------------------------------------------------- schema */

declare global {
  var __workspaceSchema: { sql: string; ready: Promise<void> } | undefined;
}

export function ensureWorkspaceSchema(): Promise<void> {
  const cur = globalThis.__workspaceSchema;
  if (cur && cur.sql === schemaSql) return cur.ready;
  const ready = q(schemaSql).then(
    () => undefined,
    (err) => {
      globalThis.__workspaceSchema = undefined;
      throw err;
    },
  );
  globalThis.__workspaceSchema = { sql: schemaSql, ready };
  return ready;
}

const MISSING = new Set(["42P01", "3F000"]); // undefined_table, invalid_schema_name

/** Query that first makes sure the workspace tables exist (and recreates them once if the db was dropped). */
async function wq<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  await ensureWorkspaceSchema();
  try {
    return await q<T>(text, params);
  } catch (err) {
    if (!MISSING.has((err as { code?: string }).code ?? "")) throw err;
    globalThis.__workspaceSchema = undefined;
    await ensureWorkspaceSchema();
    return q<T>(text, params);
  }
}
async function wone<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T | undefined> {
  return (await wq<T>(text, params))[0];
}

/** Which of the activities agent's tables exist yet. */
async function studioTables() {
  const r = await one<{ activities: boolean; events: boolean; syncs: boolean }>(
    `select to_regclass('studio.activities') is not null as activities,
            to_regclass('studio.activity_events') is not null as events,
            to_regclass('studio.syncs') is not null as syncs`,
  );
  return r;
}

/**
 * Whether a route exists in this app (anything but a 404), probed with a HEAD request to this server.
 * Used to degrade gracefully while the activities agent's routes (/api/sync, /activities/new) land.
 */
const probeCache = new Map<string, { ok: boolean; at: number }>();
export async function routeExists(request: Request, path: string) {
  const hit = probeCache.get(path);
  if (hit && Date.now() - hit.at < 10_000) return hit.ok;
  let ok = false;
  try {
    const res = await fetch(new URL(path, request.url), { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(2000) });
    ok = res.status !== 404;
  } catch {
    ok = false;
  }
  probeCache.set(path, { ok, at: Date.now() });
  return ok;
}

/* --------------------------------------------------------- settings */

export type Settings = { smallN: number; region: string; regionName: string };

export async function getSettings(): Promise<Settings> {
  const rows = await wq<{ key: string; value: unknown }>(`select key, value from studio.settings`);
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const n = Number(get("small_sample_n"));
  const region = typeof get("target_region") === "string" ? (get("target_region") as string) : "53033";
  const g = await one<{ name: string } | undefined>(`select name from app.geography where code = $1 limit 1`, [region]);
  return { smallN: Number.isFinite(n) && n >= 1 ? n : 10, region, regionName: g?.name ?? region };
}

export async function saveSettings(s: { smallN?: number; region?: string }) {
  if (s.smallN !== undefined) {
    if (!Number.isInteger(s.smallN) || s.smallN < 1 || s.smallN > 100) return { ok: false as const, field: "smallN", error: "Enter a whole number from 1 to 100." };
    await wq(`insert into studio.settings (key, value) values ('small_sample_n', $1::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()`, [JSON.stringify(s.smallN)]);
  }
  if (s.region !== undefined) {
    const ok = (await regions()).some((r) => r.code === s.region);
    if (!ok) return { ok: false as const, field: "region", error: "Choose a region that has posting data." };
    await wq(`insert into studio.settings (key, value) values ('target_region', $1::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()`, [JSON.stringify(s.region)]);
  }
  return { ok: true as const };
}

/** Regions with benchmark and posting data for the reporting period. */
export async function regions() {
  return q<{ code: string; name: string; postings: number }>(
    `select g.code, g.name, coalesce(sum(m.unique_postings), 0)::int as postings
     from app.geography g join app.posting_metrics m on m.geo_code = g.code and m.period_start = $1
     where exists (select 1 from app.benchmark_skills b where b.geo_code = g.code and b.period_start = $1)
     group by g.code, g.name order by g.name`,
    [PERIOD],
  );
}

export async function accountData() {
  const [settings, regionList, inst] = await Promise.all([
    getSettings(),
    regions(),
    one<{ name: string; programs: number; school: number; alumni: number; courses: number; employers: number }>(
      `select i.name,
              (select count(*) from app.programs where institution_id = i.id)::int as programs,
              (select count(*) from app.programs p where ${SCHOOL})::int as school,
              (select count(*) from app.alumni where institution_id = i.id)::int as alumni,
              (select count(*) from app.courses where institution_id = i.id)::int as courses,
              (select count(distinct employer) from app.alumni where institution_id = i.id)::int as employers
       from app.institutions i where i.id = $1`,
      [INSTITUTION],
    ),
  ]);
  const bench = await one<{ postings: number; occs: number }>(
    `select coalesce(sum(unique_postings), 0)::int as postings, count(distinct occ_code)::int as occs
     from app.posting_metrics where geo_code = $1 and period_start = $2`,
    [settings.region, PERIOD],
  );
  return { settings, regions: regionList, institution: { ...inst, dataAsOf: DATA_AS_OF, period: PERIOD.slice(0, 4), benchmark: bench } };
}

/* --------------------------------------------------------- programs */

export type ProgramFrame = {
  id: string;
  name: string;
  alumni: number;
  email: number;
  matched: number;
  noJob: number;
  noJobEmail: number;
  noWage: number;
  employers: number;
  employedWithEmployer: number;
};

/** School of Business programs with the real counts every workspace page needs. */
export async function programFrames(): Promise<ProgramFrame[]> {
  return q<ProgramFrame>(
    `select p.id, p.name,
            count(a.id)::int as alumni,
            count(a.id) filter (where a.has_email)::int as email,
            count(a.id) filter (where a.has_employment)::int as matched,
            count(a.id) filter (where not coalesce(a.has_employment, false))::int as "noJob",
            count(a.id) filter (where not coalesce(a.has_employment, false) and a.has_email)::int as "noJobEmail",
            count(a.id) filter (where a.wage_amount is null)::int as "noWage",
            count(distinct a.employer)::int as employers,
            count(a.id) filter (where a.employer is not null)::int as "employedWithEmployer"
     from app.programs p left join app.alumni a on a.program_id = p.id
     where ${SCHOOL}
     group by p.id, p.name
     order by count(a.id) desc, p.name`,
  );
}

/* ---------------------------------------------------------- surveys */

// Survey code lives in ./surveys.server (questions, recipients, links, responses, results); re-exported here so
// existing imports from workspace.server keep working.
export * from "./surveys.server";

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

/* ------------------------------------------------------ integrations */

type JsonItem = string | number | Record<string, unknown>;
export type Ref = { id: string; label: string; href?: string; program?: string; note?: string };

/** Normalises the activities agent's jsonb lists (ids or objects) into labelled references. */
async function resolveRefs(items: unknown, kind: "program" | "activity"): Promise<Ref[]> {
  const list = (Array.isArray(items) ? items : []) as JsonItem[];
  const refs = list.map((it) => {
    if (typeof it === "string" || typeof it === "number") return { id: String(it), label: "" };
    const o = it as Record<string, unknown>;
    const id = String(
      (kind === "program" ? (o.program_id ?? o.programId ?? o.id) : (o.activity_id ?? o.activityId ?? o.id)) ?? "",
    );
    const label = String(o.title ?? o.name ?? o.label ?? o.program_name ?? "");
    const program = String(o.program_id ?? o.programId ?? "");
    const remaining = Array.isArray(o.remaining) ? (o.remaining as { label?: string }[]) : null;
    const note = remaining?.length ? remaining.map((r) => r.label).filter(Boolean).join("; ") : undefined;
    return { id, label, program, note };
  });
  if (!refs.length) return [];
  if (kind === "program") {
    const names = await q<{ id: string; name: string }>(`select id, name from app.programs where id = any($1)`, [refs.map((r) => r.id)]);
    return refs.map((r) => ({ id: r.id, label: r.label || names.find((n) => n.id === r.id)?.name || r.id }));
  }
  const t = await studioTables();
  const acts = t.activities
    ? await q<{ id: string; title: string; kind: Kind; stage: string; program: string }>(
        `select a.id::text, a.title, a.kind, a.stage, coalesce(p.name, a.program_id) as program from studio.activities a
         left join app.programs p on p.id = a.program_id where a.id::text = any($1)`,
        [refs.map((r) => r.id)],
      )
    : [];
  return refs.map((r) => {
    const a = acts.find((x) => x.id === r.id);
    return { id: r.id, label: r.label || a?.title || "Activity", href: a ? activityPath(a) : undefined, program: a ? `${KINDS[a.kind].label} · ${a.program}` : undefined, note: r.note };
  });
}

export type SyncRow = { id: number; ranAt: string; source: string; demo: boolean; changed: Ref[]; closed: Ref[]; flagged: Ref[]; activityId: string | null };

export async function syncHistory(limit = 25): Promise<{ available: boolean; rows: SyncRow[]; total: number }> {
  const t = await studioTables();
  if (!t.syncs) return { available: false, rows: [], total: 0 };
  const rows = await q<{ id: number; ran_at: Date; source: string; with_demo_corrections: boolean; changed_programs: unknown; closed: unknown; flagged: unknown; activity_id: string | null }>(
    `select id::int, ran_at, source, with_demo_corrections, changed_programs, closed, flagged, activity_id::text from studio.syncs order by ran_at desc limit $1`,
    [limit],
  );
  const total = (await one<{ n: number }>(`select count(*)::int as n from studio.syncs`)).n;
  const out = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      ranAt: iso(r.ran_at)!,
      source: r.source,
      demo: r.with_demo_corrections,
      activityId: r.activity_id,
      changed: await resolveRefs(r.changed_programs, "program"),
      closed: await resolveRefs(r.closed, "activity"),
      flagged: await resolveRefs(r.flagged, "activity"),
    })),
  );
  return { available: true, rows: out, total };
}

const tableName = (file: string) => file.replace(/\.json$/, "").replace(/-/g, "_");

export async function datasets() {
  const cat = await q<{ file: string; title: string; kind: string; origin: string }>(
    `select record->>'sampleFile' as file, record->>'title' as title, record->>'kind' as kind, record->>'sampleOrigin' as origin from raw.catalog`,
  ).catch(() => []);
  const tables = await q<{ name: string }>(`select table_name as name from information_schema.tables where table_schema = 'raw' order by 1`);
  if (!tables.length) return { rows: [], importedAt: null as string | null };
  const counts = await q<{ name: string; n: number }>(tables.map((t) => `select '${t.name}' as name, count(*)::int as n from raw."${t.name}"`).join(" union all "));
  // There is no import log; the stats collector's first analyze after the load is the closest timestamp.
  const stamp = await one<{ at: Date | null }>(
    `select max(greatest(last_analyze, last_autoanalyze)) as at from pg_stat_user_tables where schemaname = 'raw'`,
  );
  const rows = tables.map((t) => {
    const c = cat.find((x) => x.file && tableName(x.file) === t.name);
    return {
      table: `raw.${t.name}`,
      file: c?.file ?? `${t.name.replace(/_/g, "-")}.json`,
      title: c?.title ?? (t.name === "catalog" ? "Dataset catalog" : t.name),
      kind: c?.kind ?? "catalog",
      origin: c?.origin ?? "—",
      records: counts.find((x) => x.name === t.name)?.n ?? 0,
    };
  });
  return { rows: rows.sort((a, b) => b.records - a.records), importedAt: iso(stamp?.at ?? null) };
}

export async function dataHealth(smallN: number) {
  const [a, small] = await Promise.all([
    one<{ alumni: number; jobs: number; titles: number; unmatched: number; no_job: number; no_job_email: number; hourly: number; annual: number; no_wage: number }>(
      `select count(*)::int as alumni,
              count(*) filter (where has_employment)::int as jobs,
              count(distinct job_title)::int as titles,
              count(*) filter (where job_title is not null and occ_code is null)::int as unmatched,
              count(*) filter (where not coalesce(has_employment, false))::int as no_job,
              count(*) filter (where not coalesce(has_employment, false) and has_email)::int as no_job_email,
              count(*) filter (where wage_period = 'hour')::int as hourly,
              count(*) filter (where wage_period = 'year')::int as annual,
              count(*) filter (where wage_amount is null)::int as no_wage
       from app.alumni where institution_id = $1`,
      [INSTITUTION],
    ),
    q<{ name: string; matched: number }>(
      `select p.name, count(a.id) filter (where a.has_employment)::int as matched
       from app.programs p left join app.alumni a on a.program_id = p.id where ${SCHOOL}
       group by p.name having count(a.id) filter (where a.has_employment) < $1 order by matched, p.name`,
      [smallN],
    ),
  ]);
  return {
    alumni: a.alumni,
    checks: [
      {
        key: "titles",
        label: "Job titles matched to an occupation",
        ok: a.unmatched === 0,
        value: a.unmatched === 0 ? "All matched" : `${a.unmatched.toLocaleString("en-US")} unmatched`,
        detail: `${a.titles} distinct titles across ${a.jobs.toLocaleString("en-US")} alumni with a job.`,
      },
      {
        key: "no_job",
        label: "Alumni with no job on record",
        ok: false,
        value: a.no_job.toLocaleString("en-US"),
        detail: `${Math.round((100 * a.no_job) / a.alumni)}% of ${a.alumni.toLocaleString("en-US")} NSSU alumni. ${a.no_job_email.toLocaleString("en-US")} of them have an email on file.`,
        href: "/surveys",
        cta: "Survey alumni",
      },
      {
        key: "wages",
        label: "Wage units",
        ok: a.hourly === 0,
        value: `${a.hourly.toLocaleString("en-US")} hourly`,
        detail: `${a.annual.toLocaleString("en-US")} annual, ${a.hourly.toLocaleString("en-US")} hourly, ${a.no_wage.toLocaleString("en-US")} missing. Hourly and annual wages are kept apart, never summed.`,
      },
      {
        key: "small",
        label: `Programs with fewer than ${smallN} known jobs`,
        ok: small.length === 0,
        value: `${small.length} programs`,
        detail: small.length ? `Flagged as small samples wherever shown: ${small.slice(0, 4).map((s) => `${s.name} (n = ${s.matched})`).join(", ")}${small.length > 4 ? `, and ${small.length - 4} more` : ""}.` : "Every School of Business program clears the threshold.",
        href: "/account#preferences",
        cta: "Change threshold",
      },
    ],
  };
}

export async function integrationsPage(request: Request) {
  const settings = await getSettings();
  const [ds, history, health, flags, syncAvailable] = await Promise.all([
    datasets(),
    syncHistory(),
    dataHealth(settings.smallN),
    wq<{ key: string; connected: boolean; connected_at: Date | null }>(`select key, connected, connected_at from studio.integrations`),
    routeExists(request, "/api/sync"),
  ]);
  const lastSync = history.rows[0]?.ranAt ?? null;
  return {
    settings,
    datasets: ds.rows,
    importedAt: ds.importedAt,
    lastSync,
    history,
    health,
    syncAvailable,
    connections: Object.fromEntries(flags.map((f) => [f.key, { connected: f.connected, at: iso(f.connected_at) }])) as Record<string, { connected: boolean; at: string | null }>,
  };
}

export async function setSimulatedConnection(key: string, connected: boolean) {
  await wq(
    `insert into studio.integrations (key, connected, connected_at, updated_at) values ($1, $2, case when $2 then now() end, now())
     on conflict (key) do update set connected = excluded.connected, connected_at = excluded.connected_at, updated_at = now()`,
    [key, connected],
  );
}

/* ----------------------------------------------------------- exports */

export type ExportRow = {
  key: string;
  source: "activity" | "quick";
  at: string;
  programId: string;
  programName: string;
  kind: string;
  format: string;
  artifact: string;
  label: string;
  activity: { id: string; title: string; kind: string; status: { key: string; label: string }; href: string } | null;
  openHref: string | null;
  downloadHref: string | null;
};

const EXPORT_KIND: Record<string, string> = { outcomes: "Outcomes claims", alignment: "Alignment and skill coverage" };

export async function exportRows(): Promise<{ rows: ExportRow[]; activitiesAvailable: boolean }> {
  const t = await studioTables();
  const quick = await wq<{ id: number; program_id: string; name: string | null; kind: string; format: string; artifact: string; created_at: Date }>(
    `select e.id::int, e.program_id, p.name, e.kind, e.format, e.artifact, e.created_at
     from studio.exports e left join app.programs p on p.id = e.program_id order by e.created_at desc limit 200`,
  );
  const rows: ExportRow[] = quick.map((e) => ({
    key: `q${e.id}`,
    source: "quick",
    at: iso(e.created_at)!,
    programId: e.program_id,
    programName: e.name ?? e.program_id,
    kind: EXPORT_KIND[e.kind] ?? e.kind,
    format: e.format,
    artifact: e.artifact,
    label: `${EXPORT_KIND[e.kind] ?? e.kind} · quick export`,
    activity: null,
    openHref: null,
    downloadHref: `/exports/${encodeURIComponent(e.program_id)}/${e.kind}.csv`,
  }));
  if (t.activities && t.events) {
    const acts = await q<{
      id: number;
      at: Date;
      data: { format?: string; artifact?: string; label?: string } | null;
      activity_id: string;
      program_id: string;
      name: string | null;
      kind: Kind;
      title: string;
      status: "open" | "running" | "closed";
      stage: string;
      needs_review: boolean;
      exported_at: Date | null;
      close_reason: "manual" | "sync" | null;
    }>(
      `select e.id::int, e.at, e.data, a.id::text as activity_id, a.program_id, p.name, a.kind, a.title, a.status, a.stage, a.needs_review, a.exported_at, a.close_reason
       from studio.activity_events e join studio.activities a on a.id = e.activity_id
       left join app.programs p on p.id = a.program_id
       where e.type = 'exported' order by e.at desc limit 200`,
    );
    for (const e of acts) {
      const format = String(e.data?.format ?? (e.kind === "review" ? "pdf" : "csv"));
      const review = e.kind === "review";
      const open = review ? `/a/${e.activity_id}/review/packet` : `/a/${e.activity_id}/outcomes/export`;
      rows.push({
        key: `a${e.id}`,
        source: "activity",
        at: iso(e.at)!,
        programId: e.program_id,
        programName: e.name ?? e.program_id,
        kind: review ? "Board packet" : format === "csv" ? "Outcomes claims" : "Outcomes story",
        format,
        artifact: String(e.data?.artifact ?? (review ? "Board packet" : "Outcomes export")),
        label: String(e.data?.label ?? e.title),
        activity: { id: e.activity_id, title: e.title, kind: e.kind, status: activityStatus(e), href: open },
        openHref: open,
        downloadHref: format === "csv" ? `/a/${e.activity_id}/outcomes/data.csv` : null,
      });
    }
  }
  rows.sort((a, b) => b.at.localeCompare(a.at));
  return { rows, activitiesAvailable: t.activities && t.events };
}

export async function exportsPage(request: Request) {
  const [{ rows, activitiesAvailable }, programs, settings, canStart] = await Promise.all([
    exportRows(),
    programFrames(),
    getSettings(),
    routeExists(request, "/activities/new"),
  ]);
  return {
    rows,
    activitiesAvailable,
    canStart,
    settings,
    programs: programs.map((p) => ({ id: p.id, name: p.name, alumni: p.alumni, matched: p.matched })),
    kpis: {
      total: rows.length,
      packets: rows.filter((r) => r.kind === "Board packet").length,
      csv: rows.filter((r) => r.format === "csv").length,
      programs: new Set(rows.map((r) => r.programId)).size,
      last: rows[0]?.at ?? null,
    },
  };
}

const slug = (s: string) => s.replace(/^program-north-sound-state-/, "nssu-");

/** Records a quick export and returns where to download it. */
export async function recordQuickExport(programId: string, kind: string) {
  if (kind !== "outcomes" && kind !== "alignment") return { ok: false as const, error: "Choose what to export." };
  const csv = await buildCsv(programId, kind);
  if (!csv) return { ok: false as const, error: "Choose a School of Business program." };
  const row = await wone<{ id: number }>(
    `insert into studio.exports (program_id, kind, format, artifact, rows) values ($1, $2, 'csv', $3, $4) returning id::int`,
    [programId, kind, csv.filename, csv.rows],
  );
  return { ok: true as const, id: row!.id, href: `/exports/${encodeURIComponent(programId)}/${kind}.csv`, filename: csv.filename, rows: csv.rows };
}

const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(esc).join(",")).join("\n") + "\n";

/** Program-parametrised CSVs for quick export. Every value is a count or median from app.*; nothing simulated. */
export async function buildCsv(programId: string, kind: "outcomes" | "alignment") {
  const prog = await one<{ name: string } | undefined>(`select p.name from app.programs p where p.id = $1 and ${SCHOOL}`, [programId]);
  if (!prog) return null;
  const { smallN, region, regionName } = await getSettings();
  if (kind === "outcomes") {
    const [s, recent, ttj, top] = await Promise.all([
      one<{ alumni: number; matched: number; in_field: number; in_field_known: number; wage: number | null; wage_n: number; region: number; region_known: number; no_job: number; no_job_reach: number; hourly: number }>(
        `select count(*)::int as alumni, count(*) filter (where has_employment)::int as matched,
                count(*) filter (where in_field)::int as in_field, count(*) filter (where in_field is not null)::int as in_field_known,
                percentile_cont(0.5) within group (order by wage_amount) filter (where wage_period = 'year') as wage,
                count(*) filter (where wage_period = 'year')::int as wage_n,
                count(*) filter (where resides_in_region)::int as region, count(*) filter (where resides_in_region is not null)::int as region_known,
                count(*) filter (where not coalesce(has_employment, false))::int as no_job,
                count(*) filter (where not coalesce(has_employment, false) and (has_email or has_linkedin))::int as no_job_reach,
                count(*) filter (where wage_period = 'hour')::int as hourly
         from app.alumni where program_id = $1`,
        [programId],
      ),
      one<{ in_field: number; known: number }>(
        `select count(*) filter (where in_field)::int as in_field, count(*) filter (where in_field is not null)::int as known
         from app.alumni where program_id = $1 and graduation_year >= 2020`,
        [programId],
      ),
      one<{ n: number; within3: number; within6: number; median: number | null }>(
        `select count(*)::int as n, count(*) filter (where months <= 3)::int as within3, count(*) filter (where months <= 6)::int as within6,
                percentile_cont(0.5) within group (order by months) as median
         from app.alumni_time_to_job where program_id = $1`,
        [programId],
      ),
      one<{ name: string; n: number } | undefined>(
        `select occ_name as name, count(*)::int as n from app.alumni where program_id = $1 and has_employment and occ_name is not null
         group by 1 order by n desc, 1 limit 1`,
        [programId],
      ),
    ]);
    const p = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "—");
    const rec = "alumni-record.json";
    const claims: [string, string, number | null, number, string, string][] = [
      ["Alumni on record", String(s.alumni), s.alumni, s.alumni, "All alumni records for the program", rec],
      ["Alumni with a known job", p(s.matched, s.alumni), s.matched, s.alumni, "Share of all alumni", `${rec} · employment`],
      ["Working in their field", p(s.in_field, s.in_field_known), s.in_field, s.in_field_known, "Share of alumni with a known job and field", `${rec} · employment.employedInField`],
      ["2020–25 grads working in their field", p(recent.in_field, recent.known), recent.in_field, recent.known, "Share of 2020–25 grads with a known job and field", `${rec} · employment.employedInField`],
      ["Hired within 3 months of graduating", p(ttj.within3, ttj.n), ttj.within3, ttj.n, `Median ${ttj.median ?? "—"} months; graduation assumed in June`, `${rec} · careerEvents.startDate`],
      ["Hired within 6 months of graduating", p(ttj.within6, ttj.n), ttj.within6, ttj.n, "Grads with job dates", `${rec} · careerEvents.startDate`],
      ["Median annual pay", s.wage == null ? "—" : `$${Math.round(s.wage).toLocaleString("en-US")}`, null, s.wage_n, `Annual wages only; ${s.hourly} hourly wages excluded`, `${rec} · employment.estimatedWage`],
      ["Living in the region", p(s.region, s.region_known), s.region, s.region_known, "Alumni with a known location", `${rec} · location`],
      [`Most common job: ${top?.name ?? "—"}`, String(top?.n ?? 0), top?.n ?? 0, s.matched, "Count of alumni with a known job", `${rec} · employment.occupation`],
      ["Alumni with no job on record", String(s.no_job), s.no_job, s.alumni, `Outcomes still being collected; ${s.no_job_reach} reachable by email or LinkedIn`, `${rec} · employment, contact`],
    ];
    const rows = [
      ["program", "claim", "value", "count", "n", "small_sample", "note", "source", "data_as_of"],
      ...claims.map(([claim, value, count, n, note, source]) => [prog.name, claim, value, count, n, n < smallN ? `yes (n < ${smallN})` : "no", note, source, DATA_AS_OF]),
    ];
    return { filename: `${slug(programId)}-outcomes.csv`, csv: toCsv(rows), rows: claims.length };
  }
  const targets = await q<{ occ_code: string; occ_name: string; score: number | null }>(
    `select t.occ_code, coalesce(o.name, t.occ_code) as occ_name,
            (select max(a.score) from app.alignment a where a.program_id = t.program_id and a.occ_code = t.occ_code and a.geo_code = $2 and a.period_start = $3) as score
     from app.program_targets t left join app.occupations o on o.code = t.occ_code where t.program_id = $1 order by 2`,
    [programId, region, PERIOD],
  );
  const taught = new Set(
    (
      await q<{ skill_id: string }>(
        `select skill_id from app.program_skills where program_id = $1
         union select cs.skill_id from app.program_courses pc join app.course_skills cs on cs.course_id = pc.course_id where pc.program_id = $1`,
        [programId],
      )
    ).map((r) => r.skill_id),
  );
  const rows: unknown[][] = [
    ["program", "region", "occupation", "occ_code", "alignment_score", "skill_coverage", "skill", "skill_weight", "postings_mentioning_skill", "taught_in_program", "period", "source"],
  ];
  for (const t of targets) {
    const bench = await q<{ skill_id: string; name: string; weight: number; posting_count: number }>(
      `select b.skill_id, s.name, b.weight, b.posting_count from app.benchmark_skills b join app.skills s on s.id = b.skill_id
       where b.occ_code = $1 and b.geo_code = $2 and b.period_start = $3 order by b.weight desc`,
      [t.occ_code, region, PERIOD],
    );
    const total = bench.reduce((s, b) => s + b.weight, 0);
    const hit = bench.filter((b) => taught.has(b.skill_id)).reduce((s, b) => s + b.weight, 0);
    const cov = total ? `${Math.round((100 * hit) / total)}%` : "—";
    const score = t.score == null ? "—" : `${Math.round(t.score * 100)}%`;
    if (!bench.length) rows.push([prog.name, regionName, t.occ_name, t.occ_code, score, cov, "", "", "", "", PERIOD.slice(0, 4), "occupation-alignment.json"]);
    for (const b of bench)
      rows.push([prog.name, regionName, t.occ_name, t.occ_code, score, cov, b.name, Number(b.weight).toFixed(4), b.posting_count, taught.has(b.skill_id) ? "yes" : "no", PERIOD.slice(0, 4), "occupation-benchmark.json · curricular-skill.json"]);
  }
  return { filename: `${slug(programId)}-alignment.csv`, csv: toCsv(rows), rows: rows.length - 1 };
}
