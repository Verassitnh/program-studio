// Activities: persistent records of the dean working on one program (a Program review or an Outcomes story).
// Every write to studio.* goes through this module, called from React Router actions.
import { data } from "react-router";
import { applyStudio, runSync, type SyncRow } from "../../scripts/lib/pipeline.mjs";
import { one, pool, q } from "./db.server";
import { KINDS, activityPath, firstStage, isAnalysis, isKind, isStage, type ActivityStatus, type ActivityView, type Issue, type Kind, type Lifecycle } from "./activity";

export type { SyncRow };

const NSSU = "north-sound-state";
/** The program the legacy /review/* and /outcomes/* URLs (and "Start a review") open. */
export const DEFAULT_PROGRAM = "program-north-sound-state-business-bachelor";
const ROOT = process.cwd();

type Row = {
  id: string;
  program_id: string | null;
  ref_id: string | null;
  kind: Kind;
  status: Lifecycle;
  stage: string;
  title: string;
  state: Record<string, unknown>;
  fingerprint: string | null;
  issues: Issue[];
  needs_review: boolean;
  opened_at: Date;
  updated_at: Date;
  exported_at: Date | null;
  closed_at: Date | null;
  close_reason: "manual" | "sync" | "finished" | "failed" | null;
  close_note: string | null;
  /** The program has a survey sent and still open (studio.surveys); joined in by SELECT below. */
  survey_open?: boolean | null;
};

/** Activity columns plus whether the program is waiting on survey answers. */
const SELECT = `a.*, exists (select 1 from studio.surveys s where s.program_id = a.program_id and s.status = 'sent') as survey_open`;

/* ------------------------------------------------------------ schema */

let ready: Promise<unknown> | null = null;

/** Applies db/studio*.sql once per server process (idempotent), so a fresh database works without a re-import. */
export function ensureStudio() {
  ready ??= applyStudio(pool, ROOT).catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

/** Runs a query after ensureStudio; if the schema vanished under us (dropdb + import), re-applies once. */
async function sq<T>(text: string, params: unknown[] = []): Promise<T[]> {
  await ensureStudio();
  try {
    return await q<T>(text, params);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "42P01" && code !== "3F000" && code !== "42883") throw err;
    ready = null;
    await ensureStudio();
    return q<T>(text, params);
  }
}

/* ------------------------------------------------------------ status */

/**
 * The one place the thread label is derived.
 *   Completed        closed by a sync, or closed by hand after an export
 *   Closed early     closed by hand with nothing exported
 *   Collecting data  flagged needs_review by a sync, or the program has a survey sent and still open
 *   Exported         artifact produced (packet printed, story exported, CSV downloaded), not closed
 *   In progress      otherwise
 * Surveys: open → Collecting data, closed → Completed. Syncs: running → In progress, finished → Completed,
 * failed → Failed.
 * `survey_open` is optional so callers without the join still get a label (they just can't see surveys).
 */
export function activityStatus(
  a: Pick<Row, "kind" | "status" | "stage" | "needs_review" | "exported_at" | "close_reason"> & { survey_open?: boolean | null },
): ActivityStatus {
  if (a.kind === "sync") {
    if (a.status !== "closed") return { key: "in_progress", label: "In progress" };
    return a.close_reason === "failed" ? { key: "failed", label: "Failed" } : { key: "completed", label: "Completed" };
  }
  if (a.kind === "survey") return a.status === "closed" ? { key: "completed", label: "Completed" } : { key: "collecting", label: "Collecting data" };
  if (a.status === "closed") {
    return a.close_reason === "sync" || a.exported_at ? { key: "completed", label: "Completed" } : { key: "closed_early", label: "Closed early" };
  }
  if (a.needs_review || a.survey_open) return { key: "collecting", label: "Collecting data" };
  if (a.exported_at) return { key: "exported", label: "Exported" };
  return { key: "in_progress", label: "In progress" };
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

function view(r: Row): ActivityView {
  // Stages that no longer exist (connect/sync/survey moved to onboarding) resume at the first stage.
  if (!isStage(r.kind, r.stage)) r = { ...r, stage: firstStage(r.kind) };
  return {
    id: r.id,
    programId: r.program_id,
    refId: r.ref_id,
    kind: r.kind,
    kindLabel: KINDS[r.kind].label,
    title: r.title,
    stage: r.stage,
    lifecycle: r.status,
    status: activityStatus(r),
    needsReview: r.needs_review,
    issues: r.issues ?? [],
    openedAt: iso(r.opened_at)!,
    updatedAt: iso(r.updated_at)!,
    exportedAt: iso(r.exported_at),
    closedAt: iso(r.closed_at),
    closeReason: r.close_reason,
    closeNote: r.close_note,
    state: r.state ?? {},
    path: activityPath(r),
  };
}

/* ------------------------------------------------------------ reads */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getActivity(id: string | undefined) {
  if (!id || !UUID.test(id)) return null;
  const [row] = await sq<Row>(`select ${SELECT} from studio.activities a where a.id = $1`, [id]);
  return row ? view(row) : null;
}

export async function requireActivity(id: string | undefined) {
  const a = await getActivity(id);
  if (!a) throw data("Activity not found", { status: 404, statusText: "Activity not found" });
  return a;
}

/** For stage loaders: the program the activity in the URL is about. */
export async function programOf(params: { activityId?: string }) {
  const a = await requireActivity(params.activityId);
  if (!a.programId) throw data("This activity isn't about a program", { status: 404 });
  return a.programId;
}

/** Sidebar threads, newest activity first. Closed ones are capped; the list is a history, not an archive. */
export async function listThreads() {
  await syncSurveyActivities();
  const rows = await sq<Row>(
    `(select ${SELECT} from studio.activities a where a.status <> 'closed' order by a.updated_at desc limit 50)
     union all
     (select ${SELECT} from studio.activities a where a.status = 'closed' order by a.updated_at desc limit 100)
     order by updated_at desc`,
  );
  return rows.map(view);
}

/**
 * Keeps survey activities and studio.surveys in step (idempotent; safe to call often):
 *   a sent (or already closed) survey with no activity gets one — sending is what makes a survey an activity,
 *   so this also covers scheduled surveys that went out on their own;
 *   a closed survey closes its activity (Completed).
 * Closing a survey activity closes its survey in closeActivity().
 */
export async function syncSurveyActivities() {
  await ensureStudio();
  try {
    const created = await q<{ id: string; ref_id: string }>(
      `insert into studio.activities (program_id, kind, stage, status, title, ref_id, opened_at, updated_at, closed_at, close_reason)
       select s.program_id, 'survey',
              case when s.status = 'closed' then 'closed' else 'responses' end,
              case when s.status = 'closed' then 'closed' else 'running' end,
              coalesce(p.name, s.program_id) || ' · ' || case s.audience when 'alumni' then 'Alumni survey' else 'Employer survey' end,
              s.id::text, coalesce(s.sent_at, now()), coalesce(s.closed_at, s.sent_at, now()), s.closed_at,
              case when s.status = 'closed' then 'manual' end
       from studio.surveys s left join app.programs p on p.id = s.program_id
       where s.status in ('sent', 'closed') and s.sent_at is not null
         and not exists (select 1 from studio.activities a where a.kind = 'survey' and a.ref_id = s.id::text)
       returning id, ref_id`,
    );
    for (const c of created) await event(c.id, "opened", { survey_id: Number(c.ref_id) });
    const closed = await q<{ id: string }>(
      `update studio.activities a set status = 'closed', stage = 'closed', closed_at = coalesce(s.closed_at, now()), close_reason = 'manual', updated_at = now()
       from studio.surveys s
       where a.kind = 'survey' and a.ref_id = s.id::text and s.status = 'closed' and a.status <> 'closed'
       returning a.id`,
    );
    for (const c of closed) await event(c.id, "closed", { reason: "survey closed" });
  } catch (err) {
    // studio.surveys or app.programs can be missing mid-import; the next call catches up.
    const code = (err as { code?: string }).code;
    if (code !== "42P01" && code !== "3F000") throw err;
  }
}

/** The survey activity for a studio.surveys id (after making sure it exists). */
export async function surveyActivity(surveyId: number) {
  await syncSurveyActivities();
  const [row] = await sq<Row>(`select ${SELECT} from studio.activities a where a.kind = 'survey' and a.ref_id = $1`, [String(surveyId)]);
  return row ? view(row) : null;
}

/** The latest non-closed activity for a program and kind, or null. Read-only: never creates one. */
export async function findLive(programId: string, kind: Kind) {
  const [row] = await sq<Row>(
    `select ${SELECT} from studio.activities a where a.program_id = $1 and a.kind = $2 and a.status <> 'closed' order by a.updated_at desc limit 1`,
    [programId, kind],
  );
  return row ? view(row) : null;
}

/** Latest non-closed activity per program and kind, for the dashboard's per-row indicator. */
export async function liveByProgram() {
  const rows = await sq<Row>(
    `select distinct on (a.program_id, a.kind) ${SELECT} from studio.activities a
     where a.status <> 'closed' and a.program_id is not null order by a.program_id, a.kind, a.updated_at desc`,
  );
  const out: Record<string, Partial<Record<Kind, ActivityView>>> = {};
  for (const r of rows) (out[r.program_id!] ??= {})[r.kind] = view(r);
  return out;
}

/** One studio.syncs row (a sync activity's results). */
export async function syncRun(id: number) {
  if (!Number.isInteger(id)) return null;
  const [row] = await sq<SyncRow>(`select * from studio.syncs where id = $1`, [id]);
  return row ?? null;
}

export async function latestSync() {
  const [row] = await sq<SyncRow>(`select * from studio.syncs order by id desc limit 1`);
  return row ?? null;
}

/* ------------------------------------------------------------ writes */

async function event(id: string, type: string, payload: Record<string, unknown> = {}) {
  await q(`insert into studio.activity_events (activity_id, type, data) values ($1, $2, $3)`, [id, type, JSON.stringify(payload)]);
}

/**
 * Starts work on a program: resumes the latest non-closed activity of that kind for the program, or
 * opens a new one with a snapshot of the program's data (fingerprint + open data issues).
 */
export async function startActivity({ programId, kind, stage }: { programId: string; kind: Kind; stage?: string }) {
  if (!isKind(kind) || !isAnalysis(kind)) throw data("Only reviews and outcomes stories start here", { status: 400 });
  await ensureStudio();
  const prog = await one<{ name: string } | undefined>(`select name from app.programs where id = $1 and institution_id = $2`, [programId, NSSU]);
  if (!prog) throw data("Unknown program", { status: 400 });
  const start = stage && isStage(kind, stage) ? stage : firstStage(kind);
  // Find-or-create under a per-program+kind transaction lock, so double clicks and parallel requests
  // (a row click racing a legacy redirect) can't open two activities for the same work.
  const client = await pool.connect();
  let live: Row | undefined;
  let row: Row | undefined;
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`activity:${programId}:${kind}`]);
    [live] = (
      await client.query<Row>(
        `select * from studio.activities where program_id = $1 and kind = $2 and status <> 'closed' order by updated_at desc limit 1`,
        [programId, kind],
      )
    ).rows;
    if (!live) {
      [row] = (
        await client.query<Row>(
          `insert into studio.activities (program_id, kind, stage, status, title, fingerprint, issues)
           values ($1, $2, $3, case when $3::text = $5::text then 'open' else 'running' end, $4, studio.program_fingerprint($1), studio.program_issues($1))
           returning *`,
          [programId, kind, start, prog.name, firstStage(kind)],
        )
      ).rows;
      await client.query(`insert into studio.activity_events (activity_id, type, data) values ($1, 'opened', $2)`, [
        row.id,
        JSON.stringify({ stage: start, fingerprint: row.fingerprint, issues: row.issues }),
      ]);
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  if (live) {
    await event(live.id, "resumed", {});
    if (stage && isStage(kind, stage) && stage !== live.stage) return { activity: await visitStage(live.id, stage), created: false };
    return { activity: (await getActivity(live.id))!, created: false };
  }
  return { activity: (await getActivity(row!.id))!, created: true };
}

/** A stage visit: moves the activity's stage and bumps it to the top. Closed activities are read-only. */
export async function visitStage(id: string, stage: string) {
  const a = await requireActivity(id);
  if (a.lifecycle === "closed" || !isStage(a.kind, stage)) return a;
  const [row] = await sq<Row>(
    `update studio.activities set stage = $2, updated_at = now(),
            status = case when status = 'open' and $2::text <> $3::text then 'running' else status end
     where id = $1 returning *`,
    [id, stage, firstStage(a.kind)],
  );
  if (stage !== a.stage) await event(id, "stage", { from: a.stage, to: stage });
  return (await getActivity(row.id))!;
}

/** Saves one key of the activity's state (e.g. the review's change selections). */
export async function saveState(id: string, key: string, value: unknown) {
  const a = await requireActivity(id);
  if (a.lifecycle === "closed") throw data("This activity is closed. Reopen it to make changes.", { status: 409 });
  const [row] = await sq<Row>(
    `update studio.activities set state = jsonb_set(state, array[$2::text], $3::jsonb, true), updated_at = now(),
            status = case when status = 'open' then 'running' else status end
     where id = $1 returning *`,
    [id, key, JSON.stringify(value ?? null)],
  );
  await event(id, "state", { key, value });
  return (await getActivity(row.id))!;
}

export async function closeActivity(id: string, note?: string) {
  const a = await requireActivity(id);
  if (a.lifecycle === "closed" || a.kind === "sync") return a; // syncs finish on their own
  if (a.kind === "survey" && a.refId) {
    // Closing a survey activity closes the survey (responses freeze), and vice versa (syncSurveyActivities).
    const { closeSurvey } = await import("./workspace.server");
    await closeSurvey(Number(a.refId));
  }
  const text = note?.trim().slice(0, 500) || null;
  const [row] = await sq<Row>(
    `update studio.activities set status = 'closed', closed_at = now(), close_reason = 'manual', close_note = $2, updated_at = now()
     where id = $1 returning *`,
    [id, text],
  );
  await event(id, "closed", { reason: "manual", note: text, stage: a.stage, early: !a.exportedAt });
  return (await getActivity(row.id))!;
}

export async function reopenActivity(id: string) {
  const a = await requireActivity(id);
  // A closed survey stays closed (send a new wave from Surveys); a sync is a record of a run.
  if (a.lifecycle !== "closed" || !isAnalysis(a.kind)) return a;
  const [row] = await sq<Row>(
    `update studio.activities set status = 'running', closed_at = null, close_reason = null, close_note = null, updated_at = now()
     where id = $1 returning *`,
    [id],
  );
  await event(id, "reopened", { previous: { reason: a.closeReason, note: a.closeNote, closed_at: a.closedAt } });
  return (await getActivity(row.id))!;
}

/** Clears the "Data updated — review again" flag once the dean has looked. */
export async function acknowledgeReview(id: string) {
  const [row] = await sq<Row>(`update studio.activities set needs_review = false, updated_at = now() where id = $1 returning *`, [id]);
  if (!row) throw data("Activity not found", { status: 404 });
  await event(id, "reviewed", {});
  return (await getActivity(row.id))!;
}

export type ExportFormat = "pdf" | "csv" | "print";

/** An artifact left the building (packet printed, story saved as PDF, CSV downloaded). */
export async function recordExport(id: string, { format, artifact, label }: { format: ExportFormat; artifact: string; label?: string }) {
  const a = await requireActivity(id);
  await event(id, "exported", { format, artifact, ...(label ? { label } : {}) });
  if (a.lifecycle === "closed") return a;
  const [row] = await sq<Row>(
    `update studio.activities set exported_at = coalesce(exported_at, now()), updated_at = now(),
            status = case when status = 'open' then 'running' else status end
     where id = $1 returning *`,
    [id],
  );
  return (await getActivity(row.id))!;
}

/* ------------------------------------------------------------ sync */

let syncing: Promise<SyncRow> | null = null;

/**
 * Same pipeline as `npm run db:sync`: re-import raw + app, then auto-close or flag activities.
 * One at a time per process; the pipeline also takes a Postgres advisory lock against the CLI.
 */
export async function syncNow({ source = "ui", withDemoCorrections = false }: { source?: string; withDemoCorrections?: boolean }) {
  if (syncing) return syncing;
  syncing = (async () => {
    await ensureStudio();
    const client = await pool.connect();
    try {
      return (await runSync(client, { root: ROOT, source, withDemoCorrections })).sync;
    } finally {
      client.release();
    }
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}
