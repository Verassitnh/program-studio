/**
 * Surveys: questions, recipients and private links, real responses, results and outcome corrections.
 * Re-exported from app/lib/workspace.server.ts, so existing imports (onboarding, /activities/new, reviews)
 * keep working. Owns db/studio-workspace.surveys.sql, applied lazily once per process (after the workspace file).
 *
 * ── Survey API ───────────────────────────────────────────────────────────────────────────────────────
 *   listSurveys(filter?) / getSurvey(id) / surveyForProgram(programId)      rows with real progress
 *   createSurvey({ programId, audience, template?, activityId? })          seeds the template's questions
 *   sendSurvey(id, { at? })   builds the recipient list (if needed), creates one private link per included
 *                             recipient, marks them Sent and opens the survey activity. Schedules when `at`
 *                             is in the future. NO EMAIL IS SENT: delivery is simulated; the links are real.
 *   remindSurvey(id)          reminder to recipients who haven't completed (simulated delivery, real count)
 *   closeSurvey(id), duplicateSurvey(id), newVersion(id), deleteDraft(id), createDraftsForUnknownOutcomes()
 *
 *   Questions: getQuestions, saveQuestions (refused once any response exists), applyTemplate.
 *   Recipients: listRecipients, setIncluded, saveMessage.
 *   Respondent (/s/:token): openLink (marks Opened), saveAnswer (Started), submitResponse (Completed).
 *   Results: surveyResults(id, { demo }), correctionStatus(id), addDemoResponses(id), clearDemoResponses(id).
 *
 * Real vs demo: answers given through a link are real rows (is_demo = false). "Add demo responses" inserts
 * rows flagged is_demo = true, always shown apart and labelled "demo"; they never feed corrections unless a
 * sync runs with the demo-corrections opt-in. studio.apply_survey_corrections() (called by the sync pipeline)
 * fills unknown jobs from real job answers.
 */
import { randomBytes } from "node:crypto";
import surveysSql from "../../db/studio-workspace.surveys.sql?raw";
import {
  type Answer,
  type Answers,
  type JobAnswer,
  type Logic,
  type Message,
  type QType,
  type Question,
  type TemplateContext,
  buildTemplate,
  defaultMessage,
  estimateMinutes,
  isAnswered,
  surveyTemplate,
  validateQuestions,
  visibleQuestions,
} from "~/components/surveys/model";
import { type Audience, type SurveyStatus, DEFAULT_TEMPLATE } from "~/components/workspace/model";
import { syncSurveyActivities } from "./activities.server";
import { targetOccupation } from "./data.server";
import { one, pool, q } from "./db.server";
import { SCHOOL, ensureWorkspaceSchema, getSettings, programFrames } from "./workspace.server";

const PERIOD = "2024-01";
const REGION = "53033";

/* ----------------------------------------------------------- schema */

declare global {
  var __surveysSchema: { sql: string; ready: Promise<void> } | undefined;
}

function ensureSurveySchema(): Promise<void> {
  const cur = globalThis.__surveysSchema;
  if (cur && cur.sql === surveysSql) return cur.ready;
  const ready = ensureWorkspaceSchema()
    .then(() => q(surveysSql))
    .then(
      () => undefined,
      (err) => {
        globalThis.__surveysSchema = undefined;
        throw err;
      },
    );
  globalThis.__surveysSchema = { sql: surveysSql, ready };
  return ready;
}

const MISSING = new Set(["42P01", "3F000", "42703", "42883"]); // undefined table / schema / column / function

async function sq<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  await ensureSurveySchema();
  try {
    return await q<T>(text, params);
  } catch (err) {
    if (!MISSING.has((err as { code?: string }).code ?? "")) throw err;
    globalThis.__surveysSchema = undefined;
    await ensureSurveySchema();
    return q<T>(text, params);
  }
}
async function sone<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T | undefined> {
  return (await sq<T>(text, params))[0];
}

async function tx<T>(fn: (c: { query: <R = Record<string, unknown>>(t: string, p?: unknown[]) => Promise<R[]> }) => Promise<T>): Promise<T> {
  await ensureSurveySchema();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const out = await fn({ query: async <R,>(t: string, p: unknown[] = []) => (await client.query(t, p)).rows as R[] });
    await client.query("commit");
    return out;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const nf = (n: number) => n.toLocaleString("en-US");
const newToken = () => randomBytes(24).toString("base64url");

/* ------------------------------------------------------------ types */

/** Real response progress, from recipient rows and link activity. */
export type Progress = { included: number; sent: number; opened: number; started: number; completed: number; rate: number };

/** SIMULATED: rows added with "Add demo responses". Kept apart from `progress`. */
export type Demo = { responses: number; rate: number; nonResponders: number; day: number; label: string };

type SurveyBase = {
  id: number;
  programId: string;
  programName: string;
  audience: Audience;
  template: string;
  status: SurveyStatus;
  wave: number;
  activityId: string | null;
  /** The survey's own activity (kind 'survey'), once sent. Open it at /a/<threadId>/survey. */
  threadId: string | null;
  recipients: number;
  liveRecipients: number;
  scheduledFor: string | null;
  sentAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  reminders: string[];
};

export type SurveyRow = SurveyBase & {
  /** Real count: reachable unknown jobs (alumni) the survey could fill, or grads employed by the audience. */
  gap: number;
  gapLabel: string;
  progress: Progress;
  /** SIMULATED (demo responses added by hand). Null when there are none. */
  demo: Demo | null;
  demoResponses: number;
  questionCount: number;
  minutes: number;
  /** Questions are read-only once any response exists, or the survey is closed. */
  locked: boolean;
  versionOf: number | null;
};

/* ------------------------------------------------------- live counts */

/** Recipient count before the list is built: alumni with email, or distinct employers. */
const LIVE_SQL = `case s.audience
  when 'alumni' then (select count(*) from app.alumni a where a.program_id = s.program_id and a.has_email)
  else (select count(distinct a.employer) from app.alumni a where a.program_id = s.program_id and a.employer is not null) end`;

const SURVEY_SELECT = `
  select s.id::int as id, s.program_id as "programId", coalesce(p.name, s.program_id) as "programName",
         s.audience, s.template, s.status, s.wave, s.activity_id::text as "activityId", s.version_of::int as "versionOf",
         (select a.id::text from studio.activities a where a.kind = 'survey' and a.ref_id = s.id::text limit 1) as "threadId",
         case when rp.total > 0 then rp.included else ${LIVE_SQL} end::int as "liveRecipients", s.recipients,
         s.scheduled_for as "scheduledFor", s.sent_at as "sentAt", s.closed_at as "closedAt",
         s.created_at as "createdAt", s.updated_at as "updatedAt",
         coalesce((select array_agg(e.at order by e.at) from studio.survey_events e where e.survey_id = s.id and e.type = 'reminded'), '{}') as reminders,
         case s.audience
           when 'alumni' then case when rp.total > 0 then rp.unknown
             else (select count(*) from app.alumni a where a.program_id = s.program_id and a.has_email and not coalesce(a.has_employment, false)) end
           else (select count(*) from app.alumni a where a.program_id = s.program_id and a.employer is not null) end::int as gap,
         coalesce(rp.included, 0)::int as included, coalesce(rp.sent, 0)::int as sent, coalesce(rp.opened, 0)::int as opened,
         coalesce(rp.started, 0)::int as started, coalesce(rp.completed, 0)::int as completed,
         coalesce(rs.demo, 0)::int as "demoResponses", coalesce(rs.total, 0)::int as responses,
         coalesce(qs.n, 0)::int as "questionCount", coalesce(qs.seconds, 0)::int as seconds
  from studio.surveys s left join app.programs p on p.id = s.program_id
  left join lateral (
    select count(*)::int as total, count(*) filter (where r.included)::int as included,
           count(*) filter (where r.included and r.job_known = false)::int as unknown,
           count(*) filter (where r.sent_at is not null)::int as sent, count(*) filter (where r.opened_at is not null)::int as opened,
           count(*) filter (where r.started_at is not null)::int as started, count(*) filter (where r.completed_at is not null)::int as completed
    from studio.survey_recipients r where r.survey_id = s.id) rp on true
  left join lateral (
    select count(*) filter (where x.is_demo and x.status = 'completed')::int as demo, count(*)::int as total
    from studio.survey_responses x where x.survey_id = s.id) rs on true
  left join lateral (
    select count(*)::int as n, sum(case x.type when 'job' then 45 when 'long' then 40 when 'short' then 20 else 12 end)::int + 20 as seconds
    from studio.survey_questions x where x.survey_id = s.id) qs on true`;

type RawSurvey = Omit<SurveyBase, "scheduledFor" | "sentAt" | "closedAt" | "createdAt" | "updatedAt" | "reminders" | "recipients"> & {
  scheduledFor: Date | null;
  sentAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  reminders: Date[];
  recipients: number | null;
  gap: number;
  versionOf: number | null;
  included: number;
  sent: number;
  opened: number;
  started: number;
  completed: number;
  demoResponses: number;
  responses: number;
  questionCount: number;
  seconds: number;
};

function toRow(r: RawSurvey): SurveyRow {
  const out = r.status === "sent" || r.status === "closed";
  const recipients = out ? (r.recipients ?? r.sent) : r.liveRecipients;
  const base: SurveyBase = {
    id: r.id,
    programId: r.programId,
    programName: r.programName,
    audience: r.audience,
    template: r.template,
    status: r.status,
    wave: r.wave,
    activityId: r.activityId,
    threadId: r.threadId,
    recipients,
    liveRecipients: r.liveRecipients,
    scheduledFor: iso(r.scheduledFor),
    sentAt: iso(r.sentAt),
    closedAt: iso(r.closedAt),
    createdAt: iso(r.createdAt)!,
    updatedAt: iso(r.updatedAt)!,
    reminders: (r.reminders ?? []).map((d) => iso(d)!),
  };
  const gapLabel = r.audience === "alumni" ? `Fills up to ${nf(r.gap)} unknown jobs` : `Asks the employers of ${nf(r.gap)} grads`;
  const progress: Progress = {
    included: r.included,
    sent: r.sent,
    opened: r.opened,
    started: r.started,
    completed: r.completed,
    rate: r.sent ? Math.round((100 * r.completed) / r.sent) : 0,
  };
  const demo: Demo | null = r.demoResponses
    ? {
        responses: r.demoResponses,
        rate: recipients ? Math.min(100, Math.round((100 * r.demoResponses) / recipients)) : 0,
        nonResponders: Math.max(0, recipients - r.completed),
        day: 0,
        label: "Simulated responses",
      }
    : null;
  return {
    ...base,
    gap: r.gap,
    gapLabel,
    progress,
    demo,
    demoResponses: r.demoResponses,
    questionCount: r.questionCount,
    minutes: Math.max(1, Math.round(r.seconds / 60)),
    locked: r.responses > 0 || r.status === "closed",
    versionOf: r.versionOf,
  };
}

/* -------------------------------------------------- seeding / sending */

/** Real program context for templates: required courses past the 100 level, and the target occupation's top skills. */
export async function templateContext(programId: string): Promise<TemplateContext> {
  const [prog, courses, occ] = await Promise.all([
    one<{ name: string } | undefined>(`select name from app.programs where id = $1`, [programId]),
    q<{ code: string; name: string }>(
      `select c.code, c.name from app.program_courses pc join app.courses c on c.id = pc.course_id
       where pc.program_id = $1 and pc.is_required and coalesce(substring(c.code from '[0-9]+')::int, 0) >= 200
       order by c.code limit 8`,
      [programId],
    ),
    targetOccupation(programId).catch(() => null),
  ]);
  const skills = occ
    ? await q<{ id: string; name: string }>(
        `select s.id, s.name from app.benchmark_skills b join app.skills s on s.id = b.skill_id
         where b.occ_code = $1 and b.geo_code = $2 and b.period_start = $3 order by b.weight desc, s.name limit 8`,
        [occ.code, REGION, PERIOD],
      )
    : [];
  return { programName: prog?.name ?? programId, courses, skills, occupation: occ?.name ?? "" };
}

async function insertQuestions(c: { query: (t: string, p?: unknown[]) => Promise<unknown[]> }, surveyId: number, qs: Question[]) {
  await c.query(`delete from studio.survey_questions where survey_id = $1`, [surveyId]);
  if (!qs.length) return;
  await c.query(
    `insert into studio.survey_questions (survey_id, key, position, type, prompt, help, required, options, logic)
     select $1, x.key, x.position, x.type, x.prompt, x.help, x.required, x.options, x.logic
     from jsonb_to_recordset($2::jsonb) as x(key text, position int, type text, prompt text, help text, required boolean, options jsonb, logic jsonb)`,
    [surveyId, JSON.stringify(qs.map((x, i) => ({ ...x, position: i })))],
  );
}

/** Seeds template questions for surveys that never had them (new ones, and those created before questions existed). */
async function seedMissing(ids?: number[]) {
  const todo = await sq<{ id: number; program_id: string; template: string; audience: Audience }>(
    `select id::int, program_id, template, audience from studio.surveys where not questions_seeded ${ids ? "and id = any($1)" : ""}`,
    ids ? [ids] : [],
  );
  for (const s of todo) {
    const ctx = await templateContext(s.program_id);
    const qs = buildTemplate(surveyTemplate(s.template) ? s.template : DEFAULT_TEMPLATE[s.audience], ctx);
    await tx(async (c) => {
      // Row lock: concurrent loaders seed each survey once.
      const [row] = await c.query<{ seeded: boolean; n: number }>(
        `select questions_seeded as seeded, (select count(*)::int from studio.survey_questions x where x.survey_id = s.id) as n from studio.surveys s where id = $1 for update`,
        [s.id],
      );
      if (!row || row.seeded) return;
      if (!row.n) await insertQuestions(c, s.id, qs);
      await c.query(`update studio.surveys set questions_seeded = true where id = $1`, [s.id]);
    });
  }
}

/** Builds (or tops up) the recipient list from the program's records: alumni with an email, or distinct employers. */
async function ensureRecipients(surveyId: number) {
  const s = await sone<{ program_id: string; audience: Audience; status: SurveyStatus; sent_at: Date | null; n: number }>(
    `select program_id, audience, status, sent_at, (select count(*)::int from studio.survey_recipients r where r.survey_id = s.id) as n from studio.surveys s where id = $1`,
    [surveyId],
  );
  if (!s) return;
  const sent = s.status === "sent" || s.status === "closed";
  if (sent && s.n > 0) return; // frozen at send
  if (s.audience === "alumni") {
    await sq(
      `insert into studio.survey_recipients (survey_id, kind, alumni_id, label, first_name, class_year, job_known, in_field)
       select $1, 'alumni', a.id,
              coalesce(nullif(trim(r.record->'contact'->>'fullName'), ''), 'Alumnus #' || right(a.id, 5)),
              nullif(trim(r.record->'contact'->>'firstName'), ''), a.graduation_year, coalesce(a.has_employment, false), a.in_field
       from app.alumni a left join raw.alumni_record r on r.record->>'id' = a.id
       where a.program_id = $2 and a.has_email
       on conflict (survey_id, alumni_id) where alumni_id is not null do nothing`,
      [surveyId, s.program_id],
    );
  } else {
    await sq(
      `insert into studio.survey_recipients (survey_id, kind, employer, label, grads)
       select $1, 'employer', a.employer, a.employer, count(*)::int
       from app.alumni a where a.program_id = $2 and a.employer is not null group by a.employer
       on conflict (survey_id, employer) where kind = 'employer' do nothing`,
      [surveyId, s.program_id],
    );
  }
  // Surveys sent before recipient lists existed: every recipient was sent at the original send time.
  if (sent) await issueLinks(surveyId, s.sent_at ?? new Date());
}

/** One unguessable private link per included recipient that doesn't have one yet; marks them Sent. */
async function issueLinks(surveyId: number, at: Date) {
  const rows = await sq<{ id: number }>(`select id::int from studio.survey_recipients where survey_id = $1 and included and token is null`, [surveyId]);
  if (!rows.length) return 0;
  await sq(
    `update studio.survey_recipients r set token = x.token, sent_at = $2
     from unnest($1::bigint[], $3::text[]) as x(id, token) where r.id = x.id`,
    [rows.map((r) => r.id), at, rows.map(() => newToken())],
  );
  return rows.length;
}

/** Sends scheduled surveys whose time has come (lazy: runs before survey reads). */
async function sendDue() {
  const due = await sq<{ id: number; scheduled_for: Date }>(`select id::int, scheduled_for from studio.surveys where status = 'scheduled' and scheduled_for <= now()`);
  for (const d of due) await deliver(d.id, d.scheduled_for, true);
  if (due.length) await syncSurveyActivities();
}

export async function listSurveys(filter: { status?: SurveyStatus; audience?: Audience; programId?: string } = {}) {
  await sendDue();
  await seedMissing();
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.status) where.push(`s.status = $${params.push(filter.status)}`);
  if (filter.audience) where.push(`s.audience = $${params.push(filter.audience)}`);
  if (filter.programId) where.push(`s.program_id = $${params.push(filter.programId)}`);
  const rows = await sq<RawSurvey>(`${SURVEY_SELECT} ${where.length ? `where ${where.join(" and ")}` : ""} order by s.updated_at desc, s.id desc`, params);
  return rows.map(toRow);
}

export type SurveyEvent = { id: number; at: string; type: string; data: Record<string, unknown> };

export type AudienceBreakdown =
  | { kind: "alumni"; alumni: number; email: number; noEmail: number; noJob: number; noJobEmail: number; noWage: number; cohorts: { cohort: string; n: number; email: number }[] }
  | { kind: "employers"; employers: number; grads: number; top: { employer: string; grads: number }[] };

export type SurveyDetail = SurveyRow & { events: SurveyEvent[]; breakdown: AudienceBreakdown; openSibling: number | null; message: Message };

export async function getSurvey(id: number): Promise<SurveyDetail | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  await sendDue();
  await seedMissing([id]);
  const raw = await sone<RawSurvey & { message: Partial<Message> }>(`${SURVEY_SELECT.replace("select s.id::int as id,", "select s.message, s.id::int as id,")} where s.id = $1`, [id]);
  if (!raw) return null;
  const row = toRow(raw);
  const [events, sibling] = await Promise.all([
    sq<{ id: number; at: Date; type: string; data: Record<string, unknown> }>(`select id::int, at, type, data from studio.survey_events where survey_id = $1 order by at, id`, [id]),
    sone<{ id: number }>(`select id::int from studio.surveys where program_id = $1 and audience = $2 and status <> 'closed' and id <> $3`, [row.programId, row.audience, id]),
  ]);
  return {
    ...row,
    events: events.map((e) => ({ ...e, at: iso(e.at)! })),
    breakdown: await breakdown(row.programId, row.audience),
    openSibling: sibling?.id ?? null,
    message: { ...defaultMessage(row.audience, row.programName), ...(raw.message ?? {}) },
  };
}

async function breakdown(programId: string, audience: Audience): Promise<AudienceBreakdown> {
  if (audience === "alumni") {
    const [t, cohorts] = await Promise.all([
      one<{ alumni: number; email: number; no_job: number; no_job_email: number; no_wage: number }>(
        `select count(*)::int as alumni, count(*) filter (where has_email)::int as email,
                count(*) filter (where not coalesce(has_employment, false))::int as no_job,
                count(*) filter (where not coalesce(has_employment, false) and has_email)::int as no_job_email,
                count(*) filter (where wage_amount is null)::int as no_wage
         from app.alumni where program_id = $1`,
        [programId],
      ),
      q<{ cohort: string; n: number; email: number }>(
        `select case when graduation_year is null then 'Did not complete' when graduation_year <= 2015 then '2011–15'
                     when graduation_year <= 2019 then '2016–19' else '2020–25' end as cohort,
                count(*)::int as n, count(*) filter (where has_email)::int as email
         from app.alumni where program_id = $1 group by 1 order by 1`,
        [programId],
      ),
    ]);
    return { kind: "alumni", alumni: t.alumni, email: t.email, noEmail: t.alumni - t.email, noJob: t.no_job, noJobEmail: t.no_job_email, noWage: t.no_wage, cohorts };
  }
  const [t, top] = await Promise.all([
    one<{ employers: number; grads: number }>(
      `select count(distinct employer)::int as employers, count(*) filter (where employer is not null)::int as grads from app.alumni where program_id = $1`,
      [programId],
    ),
    q<{ employer: string; grads: number }>(
      `select employer, count(*)::int as grads from app.alumni where program_id = $1 and employer is not null group by 1 order by grads desc, employer limit 8`,
      [programId],
    ),
  ]);
  return { kind: "employers", employers: t.employers, grads: t.grads, top };
}

export async function surveyForProgram(programId: string) {
  const rows = await listSurveys({ programId });
  const pick = (a: Audience) => rows.find((r) => r.audience === a && r.status !== "closed") ?? rows.find((r) => r.audience === a) ?? null;
  return { employers: pick("employers"), alumni: pick("alumni") };
}

export type Result = { ok: true; id: number; message: string } | { ok: false; error: string; existingId?: number };

export async function createSurvey(input: { programId: string; audience: Audience; template?: string; activityId?: string | null }): Promise<Result> {
  const { programId, audience } = input;
  if (audience !== "alumni" && audience !== "employers") return { ok: false, error: "Choose Employers or Alumni." };
  const template = input.template || DEFAULT_TEMPLATE[audience];
  const t = surveyTemplate(template);
  if (!t || (t.audience !== audience && t.audience !== "any")) return { ok: false, error: "Choose a template for this audience." };
  const prog = await one<{ name: string } | undefined>(`select name from app.programs p where p.id = $1 and ${SCHOOL}`, [programId]);
  if (!prog) return { ok: false, error: "Choose a School of Business program." };
  const activityId = input.activityId && /^[0-9a-f-]{36}$/i.test(input.activityId) ? input.activityId : null;
  const ins = await sone<{ id: number }>(
    `with ins as (
       insert into studio.surveys (program_id, audience, template, activity_id, wave)
       values ($1, $2, $3, $4::uuid, coalesce((select max(wave) from studio.surveys where program_id = $1 and audience = $2), 0) + 1)
       on conflict (program_id, audience) where status <> 'closed' do nothing
       returning id, wave),
     ev as (insert into studio.survey_events (survey_id, type, data) select id, 'created', jsonb_build_object('template', $3::text, 'wave', wave) from ins)
     select id::int from ins`,
    [programId, audience, template, activityId],
  );
  if (!ins) {
    const existing = await sone<{ id: number }>(`select id::int from studio.surveys where program_id = $1 and audience = $2 and status <> 'closed'`, [programId, audience]);
    return { ok: false, error: `${prog.name} already has an open ${audience} survey.`, existingId: existing?.id };
  }
  await seedMissing([ins.id]);
  return { ok: true, id: ins.id, message: `Draft created for ${prog.name}.` };
}

/**
 * The send itself: questions checked, recipient list built, one private link per included recipient.
 * Delivery is SIMULATED (no email); the links work. `at` is the send time (a scheduled time when due).
 */
async function deliver(id: number, at: Date, scheduled = false): Promise<Result> {
  const s = await sone<{ status: SurveyStatus; audience: Audience }>(`select status, audience from studio.surveys where id = $1`, [id]);
  if (!s) return { ok: false, error: "That survey no longer exists." };
  if (s.status !== "draft" && s.status !== "scheduled") return { ok: false, error: `This survey is already ${s.status}.` };
  await seedMissing([id]);
  const v = validateQuestions(await getQuestions(id));
  if (!v.ok) return { ok: false, error: `Fix the questions before sending: ${v.summary}` };
  await ensureRecipients(id);
  const inc = await sone<{ n: number }>(`select count(*)::int as n from studio.survey_recipients where survey_id = $1 and included`, [id]);
  if (!inc?.n) return { ok: false, error: s.audience === "alumni" ? "No recipients are included. Include at least one alumnus with an email on file." : "No employers are included." };
  await issueLinks(id, at);
  const up = await sone<{ recipients: number }>(
    `with up as (update studio.surveys s set status = 'sent', sent_at = $2, scheduled_for = null, updated_at = now(),
                        recipients = (select count(*) from studio.survey_recipients r where r.survey_id = s.id and r.token is not null)
                 where s.id = $1 and s.status in ('draft', 'scheduled') returning s.id, s.recipients),
          ev as (insert into studio.survey_events (survey_id, at, type, data)
                 select id, $2, 'sent', jsonb_build_object('recipients', recipients, 'scheduled', $3::boolean, 'delivery', 'simulated') from up)
     select recipients::int from up`,
    [id, at, scheduled],
  );
  return { ok: true, id, message: `Sent to ${nf(up?.recipients ?? inc.n)} ${s.audience === "alumni" ? "alumni" : "employers"} (simulated delivery: no emails go out).` };
}

export async function sendSurvey(id: number, opts: { at?: Date } = {}): Promise<Result> {
  if (opts.at && opts.at.getTime() > Date.now()) return scheduleSurvey(id, opts.at);
  const res = await deliver(id, new Date());
  if (res.ok) await syncSurveyActivities(); // the sent survey becomes an activity
  return res;
}

export async function scheduleSurvey(id: number, at: Date): Promise<Result> {
  if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) return { ok: false, error: "Choose a date after today." };
  const s = await sone<{ status: SurveyStatus }>(`select status from studio.surveys where id = $1`, [id]);
  if (!s) return { ok: false, error: "That survey no longer exists." };
  if (s.status !== "draft" && s.status !== "scheduled") return { ok: false, error: `This survey is already ${s.status}.` };
  const v = validateQuestions(await getQuestions(id));
  if (!v.ok) return { ok: false, error: `Fix the questions before scheduling: ${v.summary}` };
  await sq(
    `with up as (update studio.surveys set status = 'scheduled', scheduled_for = $2, updated_at = now() where id = $1 returning id)
     insert into studio.survey_events (survey_id, type, data) select id, 'scheduled', jsonb_build_object('for', $2::timestamptz) from up`,
    [id, at],
  );
  return { ok: true, id, message: "Scheduled. Links are created when it sends." };
}

export async function unscheduleSurvey(id: number): Promise<Result> {
  const up = await sone<{ id: number }>(
    `with up as (update studio.surveys set status = 'draft', scheduled_for = null, updated_at = now() where id = $1 and status = 'scheduled' returning id)
     , ev as (insert into studio.survey_events (survey_id, type) select id, 'unscheduled' from up) select id::int from up`,
    [id],
  );
  return up ? { ok: true, id, message: "Schedule cancelled. The survey is a draft again." } : { ok: false, error: "Only scheduled surveys can be unscheduled." };
}

/** Reminder to recipients with a link who haven't completed. Delivery simulated; the count is real. */
export async function remindSurvey(id: number): Promise<Result> {
  await sendDue();
  const s = await sone<{ status: SurveyStatus; reminders: number }>(
    `select status, (select count(*)::int from studio.survey_events e where e.survey_id = s.id and e.type = 'reminded') as reminders from studio.surveys s where id = $1`,
    [id],
  );
  if (!s) return { ok: false, error: "That survey no longer exists." };
  if (s.status !== "sent") return { ok: false, error: "Reminders go out only while a survey is sent and open." };
  if (s.reminders >= 3) return { ok: false, error: "This survey has had 3 reminders. More tend to annoy recipients." };
  await ensureRecipients(id);
  const rows = await sq<{ id: number }>(
    `update studio.survey_recipients set last_reminded_at = now(), reminders = reminders + 1
     where survey_id = $1 and token is not null and completed_at is null returning id::int`,
    [id],
  );
  if (!rows.length) return { ok: false, error: "Everyone who got a link has answered. Nobody to remind." };
  await sq(
    `with up as (update studio.surveys set updated_at = now() where id = $1 returning id)
     insert into studio.survey_events (survey_id, type, data) select id, 'reminded', jsonb_build_object('non_responders', $2::int, 'delivery', 'simulated') from up`,
    [id, rows.length],
  );
  return { ok: true, id, message: `Reminder recorded for ${nf(rows.length)} non-responders (simulated delivery).` };
}

export async function closeSurvey(id: number): Promise<Result> {
  const up = await sone<{ id: number }>(
    `with up as (update studio.surveys set status = 'closed', closed_at = now(), updated_at = now() where id = $1 and status = 'sent' returning id)
     , ev as (insert into studio.survey_events (survey_id, type) select id, 'closed' from up) select id::int from up`,
    [id],
  );
  if (up) await syncSurveyActivities(); // closes the survey's activity (Completed)
  return up ? { ok: true, id, message: "Survey closed. Links stop accepting answers." } : { ok: false, error: "Only a sent survey can be closed." };
}

/** A new draft wave with the same questions and message, once the original is closed. */
export async function duplicateSurvey(id: number): Promise<Result> {
  const s = await sone<{ program_id: string; audience: Audience; template: string; activity_id: string | null; message: Partial<Message> }>(
    `select program_id, audience, template, activity_id::text, message from studio.surveys where id = $1`,
    [id],
  );
  if (!s) return { ok: false, error: "That survey no longer exists." };
  const res = await createSurvey({ programId: s.program_id, audience: s.audience, template: surveyTemplate(s.template) ? s.template : DEFAULT_TEMPLATE[s.audience], activityId: s.activity_id });
  if (!res.ok) return { ...res, error: `${res.error} Close it before starting a new wave.` };
  const qs = await getQuestions(id);
  await tx(async (c) => {
    await insertQuestions(c, res.id, qs);
    await c.query(`update studio.surveys set message = $2, version_of = $3, questions_seeded = true where id = $1`, [res.id, JSON.stringify(s.message ?? {}), id]);
    await c.query(`insert into studio.survey_events (survey_id, type, data) values ($1, 'duplicated', jsonb_build_object('from', $2::int))`, [res.id, id]);
  });
  return { ok: true, id: res.id, message: "New draft created with the same questions." };
}

/** "Duplicate as new version" for a survey with responses: closes it (answers freeze), then copies it as a draft. */
export async function newVersion(id: number): Promise<Result> {
  const s = await sone<{ status: SurveyStatus }>(`select status from studio.surveys where id = $1`, [id]);
  if (!s) return { ok: false, error: "That survey no longer exists." };
  if (s.status === "sent") {
    const closed = await closeSurvey(id);
    if (!closed.ok) return closed;
  } else if (s.status !== "closed") {
    return { ok: false, error: "This survey can still be edited; no new version needed." };
  }
  const dup = await duplicateSurvey(id);
  return dup.ok ? { ...dup, message: "Closed this survey and opened an editable copy." } : dup;
}

export async function deleteDraft(id: number): Promise<Result> {
  const del = await sone<{ id: number }>(`delete from studio.surveys where id = $1 and status = 'draft' returning id::int`, [id]);
  return del ? { ok: true, id, message: "Draft deleted." } : { ok: false, error: "Only drafts can be deleted." };
}

/** Bulk action: an alumni draft for every School of Business program with alumni who have no job on record. */
export async function createDraftsForUnknownOutcomes(): Promise<{ ok: true; created: number; message: string }> {
  const rows = await sq<{ id: number }>(
    `with targets as (
       select p.id from app.programs p join app.alumni a on a.program_id = p.id
       where ${SCHOOL} group by p.id having count(*) filter (where not coalesce(a.has_employment, false)) > 0),
     ins as (
       insert into studio.surveys (program_id, audience, template, wave)
       select t.id, 'alumni', 'alumni-outcomes', coalesce((select max(wave) from studio.surveys x where x.program_id = t.id and x.audience = 'alumni'), 0) + 1
       from targets t
       on conflict (program_id, audience) where status <> 'closed' do nothing
       returning id, wave),
     ev as (insert into studio.survey_events (survey_id, type, data) select id, 'created', jsonb_build_object('template', 'alumni-outcomes', 'wave', wave, 'bulk', true) from ins)
     select id::int from ins`,
  );
  if (rows.length) await seedMissing(rows.map((r) => r.id));
  return { ok: true, created: rows.length, message: rows.length ? `Created ${rows.length} alumni survey drafts.` : "Every program with unknown outcomes already has an open alumni survey." };
}

export async function surveysPage() {
  const [surveys, programs, settings] = await Promise.all([listSurveys(), programFrames(), getSettings()]);
  const unknownPrograms = programs.filter((p) => p.noJob > 0);
  const sent = surveys.filter((s) => s.status === "sent" || s.status === "closed");
  return {
    surveys,
    programs,
    settings,
    kpis: {
      programs: programs.length,
      unknownPrograms: unknownPrograms.length,
      noJob: programs.reduce((s, p) => s + p.noJob, 0),
      alumni: programs.reduce((s, p) => s + p.alumni, 0),
      open: surveys.filter((s) => s.status !== "closed").length,
      live: surveys.filter((s) => s.status === "sent").length,
      scheduled: surveys.filter((s) => s.status === "scheduled").length,
      drafts: surveys.filter((s) => s.status === "draft").length,
      /** Real: recipients who got a link. */
      reached: sent.reduce((s, r) => s + r.recipients, 0),
      /** Real: completed through a link. */
      responses: sent.reduce((s, r) => s + r.progress.completed, 0),
      /** SIMULATED: demo responses added by hand. */
      demoResponses: surveys.reduce((s, r) => s + r.demoResponses, 0),
    },
  };
}

/* --------------------------------------------------------- questions */

type QRow = { key: string; type: QType; prompt: string; help: string; required: boolean; options: Question["options"]; logic: Logic };

export async function getQuestions(surveyId: number): Promise<Question[]> {
  const rows = await sq<QRow>(`select key, type, prompt, help, required, options, logic from studio.survey_questions where survey_id = $1 order by position, id`, [surveyId]);
  return rows.map((r) => ({ ...r, options: r.options ?? {}, logic: r.logic ?? null }));
}

const TYPES = new Set<QType>(["single", "multi", "scale", "nps", "yesno", "short", "long", "job", "skills"]);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** Accepts only known fields and types (the editor posts the whole list as JSON). */
function sanitize(input: unknown): Question[] | null {
  if (!Array.isArray(input) || input.length > 60) return null;
  const out: Question[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const x = raw as Record<string, unknown>;
    const key = str(x.key, 40);
    if (!/^[a-z0-9_-]{4,40}$/i.test(key) || seen.has(key) || !TYPES.has(x.type as QType)) return null;
    seen.add(key);
    const o = (x.options ?? {}) as Record<string, unknown>;
    const choices = Array.isArray(o.choices)
      ? (o.choices as Record<string, unknown>[]).slice(0, 40).map((c) => ({ id: str(c.id, 80) || Math.random().toString(36).slice(2, 8), label: str(c.label, 200) }))
      : undefined;
    const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
    const options: Question["options"] = {
      ...(choices ? { choices } : {}),
      ...(o.other ? { other: true } : {}),
      ...(num(o.max) !== undefined ? { max: Math.max(0, Math.min(20, num(o.max)!)) } : {}),
      ...(num(o.min) !== undefined ? { min: Math.max(0, Math.min(1, num(o.min)!)) } : {}),
      ...(num(o.maxValue) !== undefined ? { maxValue: Math.max(2, Math.min(10, num(o.maxValue)!)) } : {}),
      ...(typeof o.minLabel === "string" ? { minLabel: str(o.minLabel, 60) } : {}),
      ...(typeof o.maxLabel === "string" ? { maxLabel: str(o.maxLabel, 60) } : {}),
      ...(typeof o.placeholder === "string" ? { placeholder: str(o.placeholder, 120) } : {}),
    };
    const l = (x.logic as { skip_if?: { question?: unknown; answer?: unknown } } | null)?.skip_if;
    const logic: Logic = l && typeof l.question === "string" && typeof l.answer === "string" ? { skip_if: { question: str(l.question, 40), answer: str(l.answer, 80) } } : null;
    out.push({ key, type: x.type as QType, prompt: str(x.prompt, 300), help: str(x.help, 400), required: !!x.required, options, logic });
  }
  return out;
}

export async function lockState(surveyId: number) {
  const r = await sone<{ status: SurveyStatus; real: number; demo: number }>(
    `select s.status, (select count(*)::int from studio.survey_responses x where x.survey_id = s.id and not x.is_demo) as real,
            (select count(*)::int from studio.survey_responses x where x.survey_id = s.id and x.is_demo) as demo
     from studio.surveys s where s.id = $1`,
    [surveyId],
  );
  if (!r) return null;
  const locked = r.status === "closed" || r.real + r.demo > 0;
  const reason =
    r.status === "closed"
      ? "This survey is closed, so its questions are a record of what was asked."
      : r.real > 0
        ? `${r.real === 1 ? "Someone has" : `${nf(r.real)} people have`} already answered. Changing the questions now would mix answers to different questions.`
        : r.demo > 0
          ? "Demo responses exist for these questions. Clear them to edit again, or duplicate as a new version."
          : null;
  return { locked, reason, status: r.status, real: r.real, demo: r.demo };
}

export async function saveQuestions(surveyId: number, input: unknown): Promise<{ ok: true; savedAt: string } | { ok: false; error: string }> {
  const qs = sanitize(input);
  if (!qs) return { ok: false, error: "Those questions couldn't be read. Reload the page and try again." };
  const lock = await lockState(surveyId);
  if (!lock) return { ok: false, error: "That survey no longer exists." };
  if (lock.locked) return { ok: false, error: lock.reason ?? "These questions are locked." };
  await tx(async (c) => {
    await insertQuestions(c, surveyId, qs);
    await c.query(`update studio.surveys set questions_seeded = true, updated_at = now() where id = $1`, [surveyId]);
  });
  return { ok: true, savedAt: new Date().toISOString() };
}

/** Everything the question editor needs. */
export async function editorData(surveyId: number) {
  const survey = await getSurvey(surveyId);
  if (!survey) return null;
  const [questions, lock, ctx] = await Promise.all([getQuestions(surveyId), lockState(surveyId), templateContext(survey.programId)]);
  return { survey, questions, lock: lock!, ctx };
}

/* -------------------------------------------------------- recipients */

export type RecipientStatus = "excluded" | "not_sent" | "sent" | "opened" | "started" | "completed";

export type RecipientRow = {
  id: number;
  kind: "alumni" | "employer";
  label: string;
  firstName: string | null;
  classYear: number | null;
  jobKnown: boolean | null;
  inField: boolean | null;
  grads: number | null;
  included: boolean;
  token: string | null;
  status: RecipientStatus;
  sentAt: string | null;
  openedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastRemindedAt: string | null;
  reminders: number;
};

export async function listRecipients(surveyId: number): Promise<RecipientRow[]> {
  await ensureRecipients(surveyId);
  const rows = await sq<{
    id: number;
    kind: "alumni" | "employer";
    label: string;
    first_name: string | null;
    class_year: number | null;
    job_known: boolean | null;
    in_field: boolean | null;
    grads: number | null;
    included: boolean;
    token: string | null;
    sent_at: Date | null;
    opened_at: Date | null;
    started_at: Date | null;
    completed_at: Date | null;
    last_reminded_at: Date | null;
    reminders: number;
  }>(
    `select id::int, kind, label, first_name, class_year, job_known, in_field, grads, included, token, sent_at, opened_at, started_at, completed_at, last_reminded_at, reminders
     from studio.survey_recipients where survey_id = $1
     order by (completed_at is not null), coalesce(job_known, true), class_year desc nulls last, grads desc nulls last, label`,
    [surveyId],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    label: r.label,
    firstName: r.first_name,
    classYear: r.class_year,
    jobKnown: r.job_known,
    inField: r.in_field,
    grads: r.grads,
    included: r.included,
    token: r.token,
    status: r.completed_at ? "completed" : r.started_at ? "started" : r.opened_at ? "opened" : r.sent_at ? "sent" : r.included ? "not_sent" : "excluded",
    sentAt: iso(r.sent_at),
    openedAt: iso(r.opened_at),
    startedAt: iso(r.started_at),
    completedAt: iso(r.completed_at),
    lastRemindedAt: iso(r.last_reminded_at),
    reminders: r.reminders,
  }));
}

export async function setIncluded(surveyId: number, ids: number[] | "all", included: boolean): Promise<Result> {
  const s = await sone<{ status: SurveyStatus }>(`select status from studio.surveys where id = $1`, [surveyId]);
  if (!s) return { ok: false, error: "That survey no longer exists." };
  if (s.status !== "draft" && s.status !== "scheduled") return { ok: false, error: "Recipients are fixed once a survey is sent." };
  const rows = await sq<{ id: number }>(
    `update studio.survey_recipients set included = $3 where survey_id = $1 and ($2::bigint[] is null or id = any($2)) returning id::int`,
    [surveyId, ids === "all" ? null : ids, included],
  );
  await sq(`update studio.surveys set updated_at = now() where id = $1`, [surveyId]);
  return { ok: true, id: surveyId, message: `${included ? "Included" : "Excluded"} ${rows.length === 1 ? "1 recipient" : `${nf(rows.length)} recipients`}.` };
}

export async function saveMessage(surveyId: number, m: Partial<Message>): Promise<Result> {
  const clean = { subject: str(m.subject, 160), intro: str(m.intro, 2000), sender: str(m.sender, 80) };
  const up = await sone<{ id: number }>(`update studio.surveys set message = $2 where id = $1 returning id::int`, [surveyId, JSON.stringify(clean)]);
  return up ? { ok: true, id: surveyId, message: "Saved" } : { ok: false, error: "That survey no longer exists." };
}

/* -------------------------------------------------------- respondent */

export type LinkState =
  | { state: "invalid" }
  | {
      state: "closed" | "completed" | "open";
      survey: { id: number; programName: string; audience: Audience; minutes: number };
      firstName: string | null;
      questions: Question[];
      answers: Answers;
      completedAt: string | null;
    };

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

async function byToken(token: string) {
  if (!TOKEN.test(token)) return null;
  return sone<{ rid: number; survey_id: number; status: SurveyStatus; audience: Audience; program_name: string; first_name: string | null; alumni_id: string | null; completed_at: Date | null }>(
    `select r.id::int as rid, s.id::int as survey_id, s.status, s.audience, coalesce(p.name, s.program_id) as program_name, r.first_name, r.alumni_id, r.completed_at
     from studio.survey_recipients r join studio.surveys s on s.id = r.survey_id left join app.programs p on p.id = s.program_id
     where r.token = $1`,
    [token],
  );
}

/** What /s/:token shows. Only this recipient's own answers are ever loaded. `mark` records the open. */
export async function openLink(token: string, { mark = true } = {}): Promise<LinkState> {
  const r = await byToken(token);
  if (!r) return { state: "invalid" };
  if (mark && r.status === "sent") await sq(`update studio.survey_recipients set opened_at = coalesce(opened_at, now()) where id = $1`, [r.rid]);
  const [questions, answers] = await Promise.all([getQuestions(r.survey_id), answersFor(r.rid)]);
  return {
    state: r.completed_at ? "completed" : r.status === "sent" ? "open" : "closed",
    survey: { id: r.survey_id, programName: r.program_name, audience: r.audience, minutes: estimateMinutes(questions) },
    firstName: r.first_name,
    questions,
    answers,
    completedAt: iso(r.completed_at),
  };
}

async function answersFor(recipientId: number): Promise<Answers> {
  const rows = await sq<{ question_key: string; value: Answer }>(
    `select a.question_key, a.value from studio.survey_answers a join studio.survey_responses x on x.id = a.response_id where x.recipient_id = $1`,
    [recipientId],
  );
  return Object.fromEntries(rows.map((r) => [r.question_key, r.value]));
}

/** Saves (or clears) one answer; the first answer starts the response and marks the recipient Started. */
export async function saveAnswer(token: string, key: string, value: Answer | null): Promise<{ ok: true } | { ok: false; error: string; state?: string }> {
  const r = await byToken(token);
  if (!r) return { ok: false, error: "This link doesn't work.", state: "invalid" };
  if (r.completed_at) return { ok: false, error: "You've already sent your answers.", state: "completed" };
  if (r.status !== "sent") return { ok: false, error: "This survey has closed.", state: "closed" };
  const exists = await sone<{ n: number }>(`select count(*)::int as n from studio.survey_questions where survey_id = $1 and key = $2`, [r.survey_id, key]);
  if (!exists?.n) return { ok: false, error: "That question isn't in this survey any more. Reload to see the latest version." };
  await tx(async (c) => {
    const [resp] = await c.query<{ id: number }>(
      `insert into studio.survey_responses (survey_id, recipient_id, alumni_id) values ($1, $2, $3)
       on conflict (recipient_id) where recipient_id is not null do update set updated_at = now() returning id::int`,
      [r.survey_id, r.rid, r.alumni_id],
    );
    if (value == null) await c.query(`delete from studio.survey_answers where response_id = $1 and question_key = $2`, [resp.id, key]);
    else
      await c.query(
        `insert into studio.survey_answers (response_id, question_key, value) values ($1, $2, $3)
         on conflict (response_id, question_key) do update set value = excluded.value, answered_at = now()`,
        [resp.id, key, JSON.stringify(value)],
      );
    await c.query(`update studio.survey_recipients set opened_at = coalesce(opened_at, now()), started_at = coalesce(started_at, now()) where id = $1`, [r.rid]);
  });
  return { ok: true };
}

/** Submits: every required, visible question must be answered. */
export async function submitResponse(token: string): Promise<{ ok: true } | { ok: false; error: string; missing?: string; state?: string }> {
  const r = await byToken(token);
  if (!r) return { ok: false, error: "This link doesn't work.", state: "invalid" };
  if (r.completed_at) return { ok: true };
  if (r.status !== "sent") return { ok: false, error: "This survey has closed.", state: "closed" };
  const [qs, answers] = await Promise.all([getQuestions(r.survey_id), answersFor(r.rid)]);
  const missing = visibleQuestions(qs, answers).find((x) => x.required && !isAnswered(x, answers[x.key]));
  if (missing) return { ok: false, error: "This one needs an answer before you send.", missing: missing.key };
  await tx(async (c) => {
    await c.query(
      `insert into studio.survey_responses (survey_id, recipient_id, alumni_id, status, completed_at) values ($1, $2, $3, 'completed', now())
       on conflict (recipient_id) where recipient_id is not null do update set status = 'completed', completed_at = now(), updated_at = now()`,
      [r.survey_id, r.rid, r.alumni_id],
    );
    await c.query(
      `update studio.survey_recipients set opened_at = coalesce(opened_at, now()), started_at = coalesce(started_at, now()), completed_at = now() where id = $1`,
      [r.rid],
    );
    await c.query(`update studio.surveys set updated_at = now() where id = $1`, [r.survey_id]);
  });
  return { ok: true };
}

/* ----------------------------------------------------------- results */

export type QuestionResult = {
  key: string;
  type: QType;
  prompt: string;
  /** Responses that answered this question. */
  n: number;
  bars?: { id: string; label: string; count: number }[];
  others?: string[];
  scale?: { value: number; count: number }[];
  mean?: number | null;
  nps?: { score: number; promoters: number; passives: number; detractors: number };
  texts?: { text: string; at: string }[];
  job?: { employed: number; notEmployed: number; gapsFilled: number; related: number; medianAnnual: number | null; annualN: number; titles: { title: string; employer: string | null; count: number }[] };
};

export type Results = { responses: number; inProgress: number; questions: QuestionResult[] };

export async function surveyResults(surveyId: number, { demo = false } = {}): Promise<Results> {
  const [qs, rows, prog] = await Promise.all([
    getQuestions(surveyId),
    sq<{ response_id: number; status: string; question_key: string; value: Answer; at: Date; job_known: boolean | null }>(
      `select x.id::int as response_id, x.status, a.question_key, a.value, a.answered_at as at,
              coalesce(rc.job_known, (select r2.job_known from studio.survey_recipients r2 where r2.survey_id = x.survey_id and r2.alumni_id = x.alumni_id limit 1)) as job_known
       from studio.survey_responses x
       join studio.survey_answers a on a.response_id = x.id
       left join studio.survey_recipients rc on rc.id = x.recipient_id
       where x.survey_id = $1 and x.is_demo = $2 and x.status = 'completed'`,
      [surveyId, demo],
    ),
    sone<{ completed: number; progress: number }>(
      `select count(*) filter (where status = 'completed')::int as completed, count(*) filter (where status = 'started')::int as progress
       from studio.survey_responses where survey_id = $1 and is_demo = $2`,
      [surveyId, demo],
    ),
  ]);
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(r.question_key, [...(by.get(r.question_key) ?? []), r]);
  const results = qs.map((q): QuestionResult => {
    const list = (by.get(q.key) ?? []).filter((r) => isAnswered(q, r.value));
    const base: QuestionResult = { key: q.key, type: q.type, prompt: q.prompt, n: list.length };
    switch (q.type) {
      case "single":
      case "multi":
      case "skills": {
        const counts = new Map<string, number>();
        const others: string[] = [];
        for (const r of list) {
          const v = r.value as { choice?: string; choices?: string[]; other?: string };
          const picked = q.type === "single" ? [v.choice ?? ""] : (v.choices ?? []);
          for (const c of picked) counts.set(c, (counts.get(c) ?? 0) + 1);
          if (v.other?.trim()) others.push(v.other.trim());
        }
        const bars = (q.options.choices ?? []).map((c) => ({ id: c.id, label: c.label, count: counts.get(c.id) ?? 0 }));
        if (q.options.other) bars.push({ id: "other", label: "Other", count: counts.get("other") ?? others.length });
        return { ...base, bars: bars.sort((a, b) => b.count - a.count), others: others.slice(0, 20) };
      }
      case "yesno": {
        const yes = list.filter((r) => (r.value as { value: string }).value === "yes").length;
        return { ...base, bars: [{ id: "yes", label: "Yes", count: yes }, { id: "no", label: "No", count: list.length - yes }] };
      }
      case "scale":
      case "nps": {
        const lo = q.type === "nps" ? 0 : Number(q.options.min ?? 1);
        const hi = q.type === "nps" ? 10 : Number(q.options.maxValue ?? 5);
        const vals = list.map((r) => Number((r.value as { value: number }).value)).filter(Number.isFinite);
        const scale = Array.from({ length: hi - lo + 1 }, (_, i) => ({ value: lo + i, count: vals.filter((v) => v === lo + i).length }));
        const mean = vals.length ? Math.round((10 * vals.reduce((s, v) => s + v, 0)) / vals.length) / 10 : null;
        if (q.type !== "nps") return { ...base, scale, mean };
        const promoters = vals.filter((v) => v >= 9).length;
        const detractors = vals.filter((v) => v <= 6).length;
        return {
          ...base,
          scale,
          mean,
          nps: { promoters, detractors, passives: vals.length - promoters - detractors, score: vals.length ? Math.round((100 * (promoters - detractors)) / vals.length) : 0 },
        };
      }
      case "short":
      case "long":
        return {
          ...base,
          texts: list
            .sort((a, b) => +new Date(b.at) - +new Date(a.at))
            .slice(0, 30)
            .map((r) => ({ text: (r.value as { text: string }).text.trim(), at: iso(r.at)! })),
        };
      case "job": {
        const jobs = list.map((r) => ({ v: r.value as JobAnswer, unknown: r.job_known === false }));
        const employed = jobs.filter((j) => j.v.employed === "yes");
        const annual = employed
          .map((j) => (j.v.unit !== "hour" && j.v.salary ? Number(j.v.salary) : NaN))
          .filter(Number.isFinite)
          .sort((a, b) => a - b);
        const titles = new Map<string, { title: string; employer: string | null; count: number }>();
        for (const j of employed) {
          const k = `${j.v.title?.trim()}|${j.v.employer?.trim() ?? ""}`;
          const t = titles.get(k) ?? { title: j.v.title?.trim() ?? "", employer: j.v.employer?.trim() || null, count: 0 };
          t.count++;
          titles.set(k, t);
        }
        return {
          ...base,
          job: {
            employed: employed.length,
            notEmployed: jobs.length - employed.length,
            gapsFilled: employed.filter((j) => j.unknown).length,
            related: employed.filter((j) => j.v.related === "yes").length,
            medianAnnual: annual.length ? annual[Math.floor((annual.length - 1) / 2)] : null,
            annualN: annual.length,
            titles: [...titles.values()].sort((a, b) => b.count - a.count).slice(0, 12),
          },
        };
      }
    }
  });
  return { responses: prog?.completed ?? 0, inProgress: prog?.progress ?? 0, questions: results };
}

/** Real job answers that the next sync will write into the alumni records, and those already applied. */
export async function correctionStatus(surveyId: number) {
  const r = await sone<{ pending: number; applied: number; demo: number }>(
    `select count(*) filter (where j.alumni_id is not null and not coalesce(al.has_employment, false))::int as pending,
            count(*) filter (where al.has_employment and lower(al.job_title) = lower(j.title))::int as applied,
            (select count(*)::int from studio.survey_job_answers(true, $1) d where d.is_demo) as demo
     from studio.survey_job_answers(false, $1) j left join app.alumni al on al.id = j.alumni_id`,
    [surveyId],
  ).catch(() => undefined);
  return { pending: r?.pending ?? 0, applied: r?.applied ?? 0, demoJobs: r?.demo ?? 0 };
}

/* -------------------------------------------------------------- demo */

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const DEMO_TITLES = ["Business Analyst", "Operations Analyst", "Account Manager", "Financial Analyst", "Project Coordinator", "Marketing Specialist", "HR Generalist"];
const DEMO_EMPLOYERS = ["Cascade Logistics", "Pine Ridge Manufacturing", "Sound Credit Union", "Evergreen Health", "Harbor Retail Group"];
const DEMO_TEXT = [
  "More hands-on Excel modeling with real, messy data.",
  "SQL basics. I had to learn it in my first month.",
  "Presenting numbers to people who don't like numbers.",
  "Project management: scoping, timelines, saying no.",
  "Tableau or Power BI dashboards.",
  "Negotiation and client conversations.",
];

function demoAnswer(q: Question): Answer | null {
  const cs = q.options.choices ?? [];
  switch (q.type) {
    case "single":
      return cs.length ? { choice: pick(cs).id } : null;
    case "multi":
    case "skills": {
      const n = Math.min(cs.length, q.options.max || 3, 1 + Math.floor(Math.random() * 3));
      return cs.length ? { choices: [...cs].sort(() => Math.random() - 0.5).slice(0, n).map((c) => c.id) } : null;
    }
    case "scale": {
      const lo = Number(q.options.min ?? 1);
      const hi = Number(q.options.maxValue ?? 5);
      return { value: Math.max(lo, Math.min(hi, hi - Math.floor(Math.random() * Math.random() * (hi - lo + 1)))) };
    }
    case "nps":
      return { value: Math.min(10, 5 + Math.floor(Math.random() * 6) + (Math.random() > 0.6 ? 1 : 0)) };
    case "yesno":
      return { value: Math.random() < 0.7 ? "yes" : "no" };
    case "short":
      return Math.random() < 0.8 ? { text: pick(["Excel, SQL", "Tableau", "Salesforce", "Power BI, Excel", "Python basics"]) } : null;
    case "long":
      return Math.random() < 0.7 ? { text: pick(DEMO_TEXT) } : null;
    case "job": {
      if (Math.random() < 0.18) return { employed: "no" };
      const y = 2021 + Math.floor(Math.random() * 5);
      const m = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
      return {
        employed: "yes",
        title: pick(DEMO_TITLES),
        employer: pick(DEMO_EMPLOYERS),
        start: `${y}-${m}`,
        salary: String(48000 + Math.round(Math.random() * 40) * 1000),
        unit: "year",
        related: Math.random() < 0.75 ? "yes" : "no",
      };
    }
  }
}

/** SIMULATED: inserts `n` completed demo responses (is_demo = true). Never counted as real. */
export async function addDemoResponses(surveyId: number, n = 10): Promise<Result> {
  const s = await sone<{ status: SurveyStatus; demo: number }>(
    `select status, (select count(*)::int from studio.survey_responses x where x.survey_id = s.id and x.is_demo) as demo from studio.surveys s where id = $1`,
    [surveyId],
  );
  if (!s) return { ok: false, error: "That survey no longer exists." };
  if (s.status !== "sent" && s.status !== "closed") return { ok: false, error: "Send the survey first; demo responses answer the sent questions." };
  if (s.demo >= 200) return { ok: false, error: "This survey already has 200 demo responses." };
  const qs = await getQuestions(surveyId);
  if (!qs.length) return { ok: false, error: "This survey has no questions." };
  const people = await sq<{ alumni_id: string }>(`select alumni_id from studio.survey_recipients where survey_id = $1 and alumni_id is not null and token is not null order by random()`, [surveyId]);
  await tx(async (c) => {
    for (let i = 0; i < n; i++) {
      const answers: Answers = {};
      // Answer in order so skip logic sees earlier answers.
      for (const q of qs) {
        if (!visibleQuestions(qs, answers).some((v) => v.key === q.key)) continue;
        const a = demoAnswer(q);
        if (a) answers[q.key] = a;
      }
      const at = new Date(Date.now() - Math.floor(Math.random() * 3 * 86_400_000));
      const [resp] = await c.query<{ id: number }>(
        `insert into studio.survey_responses (survey_id, is_demo, alumni_id, status, started_at, completed_at, updated_at) values ($1, true, $2, 'completed', $3, $3, $3) returning id::int`,
        [surveyId, people[i % Math.max(1, people.length)]?.alumni_id ?? null, at],
      );
      const entries = Object.entries(answers).filter(([, v]) => v);
      if (entries.length)
        await c.query(
          `insert into studio.survey_answers (response_id, question_key, value, answered_at) select $1, x.key, x.value, $3 from jsonb_to_recordset($2::jsonb) as x(key text, value jsonb)`,
          [resp.id, JSON.stringify(entries.map(([key, value]) => ({ key, value }))), at],
        );
    }
    await c.query(`insert into studio.survey_events (survey_id, type, data) values ($1, 'demo_responses', jsonb_build_object('added', $2::int, 'simulated', true))`, [surveyId, n]);
  });
  return { ok: true, id: surveyId, message: `Added ${n} demo responses (simulated). They're counted apart from real ones.` };
}

export async function clearDemoResponses(surveyId: number): Promise<Result> {
  const rows = await sq<{ id: number }>(`delete from studio.survey_responses where survey_id = $1 and is_demo returning id::int`, [surveyId]);
  if (rows.length) await sq(`insert into studio.survey_events (survey_id, type, data) values ($1, 'demo_cleared', jsonb_build_object('removed', $2::int))`, [surveyId, rows.length]);
  return { ok: true, id: surveyId, message: rows.length ? `Removed ${nf(rows.length)} demo responses.` : "There were no demo responses." };
}

/** Everything the survey activity page and the slide-over's Recipients/Results tabs need. */
export async function surveyWorkspace(surveyId: number, { demo = false } = {}) {
  const survey = await getSurvey(surveyId);
  if (!survey) return null;
  const [questions, recipients, results, corrections, lock] = await Promise.all([
    getQuestions(surveyId),
    listRecipients(surveyId),
    surveyResults(surveyId, { demo }),
    correctionStatus(surveyId),
    lockState(surveyId),
  ]);
  return { survey, questions, recipients, results, corrections, lock: lock! };
}
