/**
 * Programs dashboard (/): every North Sound State program in one table, plus one program's detail for the
 * slide-over. Set-based: the table is one SQL statement over app.* plus one read of studio.activities,
 * whatever the number of programs.
 *
 *   programsTable({ region, smallN }) → ProgramRow[]   all programs, unsorted (the client sorts and filters)
 *   programDetail(id, region)        → ProgramDetail | null
 *
 * Definitions (shared with the outcomes screens, so the numbers agree):
 *   coverage     max alignment score for the program, King County (53033), 2024; the only region with
 *                alignment scores for this institution
 *   occupation   the occupation with that max score
 *   in field     alumni.in_field = true over alumni with a known in-field flag
 *   unknown      alumni with no employment on record
 *   time to job  app.alumni_time_to_job (months from June of the graduation year to the first job)
 *   salary       median of current-job salaries reported per year; hourly wages are left out, not annualized
 *   demand       unique postings for the top occupation in the chosen region, 2024, and growth vs 2023
 */
import { activityPath, type Kind } from "./activity";
import { activityStatus, ensureStudio } from "./activities.server";
import { GEO, INSTITUTION, PERIOD } from "./data.server";
import { q } from "./db.server";
import { kindMeta, type ActivityKind, type ActivityRef, type Level, type ProgramDetail, type ProgramRow, type Quality } from "~/components/programs/model";

/** CIP two-digit series, named the way this school's programs read (e.g. 30 holds the Data Science programs). */
const FAMILY: Record<string, string> = {
  "03": "Environmental science",
  "09": "Communication",
  "11": "Computing and IT",
  "13": "Education",
  "14": "Engineering",
  "23": "English",
  "24": "Liberal arts",
  "26": "Biology",
  "30": "Data science",
  "42": "Psychology",
  "44": "Social work",
  "45": "Economics",
  "50": "Design",
  "51": "Health",
  "52": "Business",
};
/** Surveys (studio.surveys) cover the School of Business only; see SCHOOL in workspace.server.ts. */
const SURVEY_FAMILY = "52";

export const familyLabel = (code: string) => FAMILY[code] ?? `CIP ${code}`;

type TableRow = {
  id: string;
  name: string;
  level: Level;
  cip: string;
  cip_name: string;
  occ_code: string | null;
  occ_name: string | null;
  score: number | null;
  occupations: string[] | null;
  alumni: number;
  known: number;
  in_field: number;
  in_field_known: number;
  ttj_n: number;
  within6: number;
  median_months: number | null;
  wage_n: number;
  hourly_n: number;
  email_n: number;
  email_nojob: number;
  employers: number;
  median_wage: number | null;
  postings: number | null;
  growth: number | null;
};

type ActivityDbRow = {
  id: string;
  program_id: string;
  kind: ActivityKind;
  status: "open" | "running" | "closed";
  stage: string;
  needs_review: boolean;
  exported_at: Date | null;
  close_reason: "manual" | "sync" | null;
  opened_at: Date;
  updated_at: Date;
  closed_at: Date | null;
  survey_open: boolean;
};

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

function ref(r: ActivityDbRow): ActivityRef {
  return {
    id: r.id,
    kind: r.kind,
    kindLabel: kindMeta(r.kind).label,
    stage: r.stage,
    // One source of truth for labels (live surveys and programs waiting on a sent survey read "Collecting data").
    status: activityStatus(r as ActivityDbRow & { kind: Kind }),
    path: activityPath(r as ActivityDbRow & { kind: Kind }),
    live: r.status !== "closed",
    openedAt: iso(r.opened_at)!,
    updatedAt: iso(r.updated_at)!,
    closedAt: iso(r.closed_at),
  };
}

/** Every activity for the institution's programs, newest activity first. Empty if the studio schema can't be set up. */
async function activities(programId?: string): Promise<ActivityDbRow[]> {
  try {
    await ensureStudio();
    // survey_open matches the sidebar's status rule (a program waiting on a sent survey is "Collecting data").
    const surveys = (await q<{ ok: boolean }>(`select to_regclass('studio.surveys') is not null as ok`))[0]?.ok;
    return await q<ActivityDbRow>(
      `select a.id, a.program_id, a.kind, a.status, a.stage, a.needs_review, a.exported_at, a.close_reason, a.opened_at, a.updated_at, a.closed_at,
              ${surveys ? `exists (select 1 from studio.surveys s where s.program_id = a.program_id and s.status = 'sent')` : "false"} as survey_open
       from studio.activities a where a.program_id is not null and ($1::text is null or a.program_id = $1) order by a.updated_at desc`,
      [programId ?? null],
    );
  } catch (err) {
    console.warn(`[programs] activities unavailable: ${(err as Error).message}`);
    return [];
  }
}

const TABLE_SQL = `
with p as (
  select id, name, program_type_id as level, cip_code as cip, cip_name from app.programs where institution_id = $1
),
al as (
  select a.program_id, a.occ_code, coalesce(o.name, a.occ_name) as occ_name, a.score,
         row_number() over (partition by a.program_id order by a.score desc, a.occ_code) as rk
  from app.alignment a join p on p.id = a.program_id left join app.occupations o on o.code = a.occ_code
  where a.geo_code = $2 and a.period_start = $3
),
occs as (select program_id, json_agg(occ_name order by rk) as occupations from al group by 1),
st as (
  select a.program_id,
         count(*)::int as alumni,
         count(*) filter (where a.has_employment)::int as known,
         count(*) filter (where a.in_field)::int as in_field,
         count(*) filter (where a.in_field is not null)::int as in_field_known,
         count(*) filter (where a.wage_period = 'year')::int as wage_n,
         count(*) filter (where a.wage_period = 'hour')::int as hourly_n,
         count(*) filter (where a.has_email)::int as email_n,
         count(*) filter (where a.has_email and not a.has_employment)::int as email_nojob,
         count(distinct a.employer)::int as employers,
         percentile_cont(0.5) within group (order by a.wage_amount) filter (where a.wage_period = 'year') as median_wage
  from app.alumni a join p on p.id = a.program_id group by 1
),
tj as (
  select t.program_id, count(*)::int as n, count(*) filter (where t.months <= 6)::int as within6,
         percentile_cont(0.5) within group (order by t.months) as median
  from app.alumni_time_to_job t where t.institution_id = $1 group by 1
)
select p.id, p.name, p.level, p.cip, p.cip_name,
       al.occ_code, al.occ_name, round(al.score * 100)::int as score, occs.occupations,
       coalesce(st.alumni, 0) as alumni, coalesce(st.known, 0) as known,
       coalesce(st.in_field, 0) as in_field, coalesce(st.in_field_known, 0) as in_field_known,
       coalesce(tj.n, 0) as ttj_n, coalesce(tj.within6, 0) as within6, tj.median as median_months,
       coalesce(st.wage_n, 0) as wage_n, coalesce(st.hourly_n, 0) as hourly_n, coalesce(st.email_n, 0) as email_n, coalesce(st.email_nojob, 0) as email_nojob, coalesce(st.employers, 0) as employers, st.median_wage,
       m.unique_postings as postings, g.growth_rate as growth
from p
left join al on al.program_id = p.id and al.rk = 1
left join occs on occs.program_id = p.id
left join st on st.program_id = p.id
left join tj on tj.program_id = p.id
left join app.posting_metrics m on m.occ_code = al.occ_code and m.geo_code = $4 and m.period_start = $3
left join app.posting_growth g on g.occ_code = al.occ_code and g.geo_code = $4 and g.comparison_start = $3
order by p.name`;

export async function programsTable({ region, smallN }: { region: string; smallN: number }): Promise<ProgramRow[]> {
  const [rows, acts] = await Promise.all([q<TableRow>(TABLE_SQL, [INSTITUTION, GEO, PERIOD, region]), activities()]);
  const byProgram = new Map<string, ActivityRef[]>();
  for (const a of acts) {
    const list = byProgram.get(a.program_id) ?? [];
    list.push(ref(a));
    byProgram.set(a.program_id, list);
  }
  return rows.map((r) => {
    const all = byProgram.get(r.id) ?? [];
    const liveAll = all.filter((a) => a.live);
    const closed = all.filter((a) => !a.live).sort((a, b) => Date.parse(b.closedAt ?? b.updatedAt) - Date.parse(a.closedAt ?? a.updatedAt));
    const quality: Quality = r.alumni === 0 ? "none" : r.known < smallN ? "small" : "ok";
    const family = r.cip.slice(0, 2);
    return {
      id: r.id,
      name: r.name,
      level: r.level,
      cip: r.cip,
      cipName: r.cip_name.replace(/\.$/, ""),
      family,
      familyLabel: familyLabel(family),
      coverage: r.score,
      occupation: r.occ_code && r.occ_name ? { code: r.occ_code, name: r.occ_name } : null,
      occupations: r.occupations ?? [],
      alumni: r.alumni,
      known: r.known,
      inField: r.in_field,
      inFieldKnown: r.in_field_known,
      unknown: r.alumni - r.known,
      ttjN: r.ttj_n,
      within6: r.within6,
      medianMonths: r.median_months,
      medianWage: r.median_wage,
      wageN: r.wage_n,
      hourlyN: r.hourly_n,
      reach: { alumni: r.email_n, unknownJobs: r.email_nojob, employers: r.employers, surveyable: family === SURVEY_FAMILY },
      postings: r.postings,
      growth: r.growth,
      live: liveAll[0] ?? null,
      liveAll,
      lastClosed: closed[0] ?? null,
      quality,
    };
  });
}

/* ------------------------------------------------------------------ detail */

const DETAIL_SQL = `
with taught as (
  select skill_id from app.program_skills where program_id = $1
  union
  select cs.skill_id from app.program_courses pc join app.course_skills cs on cs.course_id = pc.course_id where pc.program_id = $1
),
codes as (
  select occ_code from app.program_targets where program_id = $1
  union
  select occ_code from app.alignment where program_id = $1 and geo_code = $2 and period_start = $3
),
known as (select * from app.alumni where program_id = $1 and has_employment),
careers as (
  select c.occ_code as code, coalesce(o.name, a.occ_name, c.occ_code) as name, round(a.score * 100)::int as score, a.score as raw,
         exists (select 1 from app.program_targets t where t.program_id = $1 and t.occ_code = c.occ_code) as target,
         m.unique_postings as postings, g.growth_rate::float as growth, m.median_salary::float as salary,
         (select count(*)::int from known k where k.occ_code = c.occ_code) as alumni,
         (select coalesce(json_agg(e order by e.n desc, e.name), '[]') from (
            select employer as name, count(*)::int as n from known k where k.occ_code = c.occ_code and employer is not null
            group by 1 order by 2 desc, 1 limit 3) e) as employers,
         (select coalesce(json_agg(json_build_object('period', pm.period_start, 'postings', pm.unique_postings) order by pm.period_start), '[]')
            from app.posting_metrics pm where pm.occ_code = c.occ_code and pm.geo_code = $4) as trend,
         (select json_build_object('total', count(*), 'taught', count(*) filter (where b.taught),
                 'gaps', coalesce((select json_agg(json_build_object('id', x.skill_id, 'name', x.name, 'weight', x.weight, 'postings', x.posting_count) order by x.weight desc, x.name)
                                   from (select * from (
                                     select b2.skill_id, s.name, b2.weight, b2.posting_count
                                     from app.benchmark_skills b2 join app.skills s on s.id = b2.skill_id
                                     where b2.occ_code = c.occ_code and b2.geo_code = $2 and b2.period_start = $3
                                       and not exists (select 1 from taught t where t.skill_id = b2.skill_id)) y
                                   order by y.weight desc, y.name limit 6) x), '[]'))
            from (select b1.skill_id, exists (select 1 from taught t where t.skill_id = b1.skill_id) as taught
                  from app.benchmark_skills b1 where b1.occ_code = c.occ_code and b1.geo_code = $2 and b1.period_start = $3) b) as bench
  from codes c
  left join app.alignment a on a.program_id = $1 and a.occ_code = c.occ_code and a.geo_code = $2 and a.period_start = $3
  left join app.occupations o on o.code = c.occ_code
  left join app.posting_metrics m on m.occ_code = c.occ_code and m.geo_code = $4 and m.period_start = $3
  left join app.posting_growth g on g.occ_code = c.occ_code and g.geo_code = $4 and g.comparison_start = $3
)
select
  (select json_build_object('description', description, 'courses', (select count(*)::int from app.program_courses where program_id = $1))
     from app.programs where id = $1) as info,
  (select coalesce(json_agg(c order by c.raw desc nulls last, c.code), '[]') from careers c) as careers,
  (select coalesce(json_agg(l order by l.n desc, l.name), '[]') from (
     select occ_code as code, coalesce(occ_name, job_title, 'Occupation not recorded') as name, count(*)::int as n
     from known group by occ_code, coalesce(occ_name, job_title, 'Occupation not recorded') order by 3 desc, 2 limit 8) l) as landings,
  (select json_build_object(
          'inField', count(*) filter (where in_field), 'outField', count(*) filter (where in_field = false),
          'unknown', count(*) filter (where not has_employment),
          'region', count(*) filter (where resides_in_region), 'regionKnown', count(*) filter (where resides_in_region is not null),
          'wageN', count(*) filter (where wage_period = 'year'),
          'wageMedian', percentile_cont(0.5) within group (order by wage_amount) filter (where wage_period = 'year'),
          'wageP25', percentile_cont(0.25) within group (order by wage_amount) filter (where wage_period = 'year'),
          'wageP75', percentile_cont(0.75) within group (order by wage_amount) filter (where wage_period = 'year'),
          'hourly', count(*) filter (where wage_period = 'hour'))
     from app.alumni where program_id = $1) as outcomes,
  (select json_build_object('n', count(*), 'within6', count(*) filter (where months <= 6),
          'within12', count(*) filter (where months > 6 and months <= 12), 'over12', count(*) filter (where months > 12),
          'median', percentile_cont(0.5) within group (order by months))
     from app.alumni_time_to_job where program_id = $1) as ttj,
  (select coalesce(json_agg(e order by e.n desc, e.name), '[]') from (
     select employer as name, count(*)::int as n from known where employer is not null
     group by 1 order by 2 desc, 1 limit 5) e) as employers`;

type DetailDb = {
  info: { description: string | null; courses: number } | null;
  careers: ProgramDetail["careers"];
  landings: ProgramDetail["landings"];
  outcomes: {
    inField: number;
    outField: number;
    unknown: number;
    region: number;
    regionKnown: number;
    wageN: number;
    wageMedian: number | null;
    wageP25: number | null;
    wageP75: number | null;
    hourly: number;
  };
  ttj: ProgramDetail["ttj"];
  employers: ProgramDetail["employers"];
};

export async function programDetail(id: string, region: string): Promise<ProgramDetail | null> {
  const [[d], acts] = await Promise.all([q<DetailDb>(DETAIL_SQL, [id, GEO, PERIOD, region]), activities(id)]);
  if (!d?.info) return null;
  const o = d.outcomes;
  return {
    id,
    description: d.info.description,
    courses: d.info.courses,
    careers: d.careers,
    landings: d.landings,
    outcomes: { inField: o.inField, outField: o.outField, unknown: o.unknown, region: o.region, regionKnown: o.regionKnown },
    ttj: d.ttj,
    wage: { n: o.wageN, median: o.wageMedian, p25: o.wageP25, p75: o.wageP75, hourly: o.hourly },
    employers: d.employers,
    activities: acts.map(ref),
  };
}
