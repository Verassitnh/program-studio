import { roleWord } from "./activity";
import { one, q } from "./db.server";

export const INSTITUTION = "north-sound-state";
export const PEER_INSTITUTION = "willow-creek-college";
export const GEO = "53033"; // King County, WA
export const PERIOD = "2024-01";
export const DATA_YEAR = 2025;
/** Used only when a program has no alignment scores at all. */
const FALLBACK_OCC = "13-1111.00"; // Management Analysts

const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);

/** Groups smaller than this get flagged wherever they are shown. */
export const SMALL_N = 10;

/* ---------------------------------------------------------------- program context */

export type Occupation = { code: string; name: string; score: number | null };

/**
 * The program's target occupation: its highest King County 2024 alignment score, among occupations that
 * have a skills benchmark (so coverage can be measured). Business Administration, B.S. → Management Analysts.
 */
export async function targetOccupation(programId: string): Promise<Occupation> {
  const row = await one<Occupation | undefined>(
    `select a.occ_code as code, coalesce(o.name, a.occ_name) as name, a.score
     from app.alignment a left join app.occupations o on o.code = a.occ_code
     where a.program_id = $1 and a.geo_code = $2 and a.period_start = $3
     order by exists (select 1 from app.benchmark_skills b where b.occ_code = a.occ_code and b.geo_code = $2 and b.period_start = $3) desc,
              a.score desc, a.occ_code
     limit 1`,
    [programId, GEO, PERIOD],
  );
  if (row) return row;
  const fb = await one<{ name: string } | undefined>(`select name from app.occupations where code = $1`, [FALLBACK_OCC]);
  return { code: FALLBACK_OCC, name: fb?.name ?? "Management Analysts", score: null };
}

export type ProgramInfo = { id: string; name: string; cip_code: string; level: "bachelor" | "master" | "other"; courses: number; peerId: string | null };

export async function programInfo(programId: string): Promise<ProgramInfo> {
  const p = await one<{ name: string; cip_code: string; program_type_id: string; courses: number } | undefined>(
    `select p.name, p.cip_code, p.program_type_id, (select count(*) from app.program_courses pc where pc.program_id = p.id)::int as courses
     from app.programs p where p.id = $1`,
    [programId],
  );
  if (!p) throw new Response("Program not found", { status: 404 });
  // The peer school's program with the same slug (e.g. Willow Creek College's Business Administration, B.S.), if it has one.
  const peerId = programId.replace(`program-${INSTITUTION}-`, `program-${PEER_INSTITUTION}-`);
  const peer = await one<{ id: string } | undefined>(`select id from app.programs where id = $1`, [peerId]);
  const level = /master/.test(programId) ? "master" : /bachelor/.test(programId) ? "bachelor" : "other";
  return { id: programId, name: p.name, cip_code: p.cip_code, level, courses: p.courses, peerId: peer?.id ?? null };
}

/** "Business Administration, B.S." → "Business Administration" */
export const shortName = (name: string) => name.replace(/,\s*[A-Z.]+$/, "");

/* ---------------------------------------------------------------- shared */

export async function taughtSkillIds(programId: string): Promise<string[]> {
  const rows = await q<{ skill_id: string }>(
    `select skill_id from app.program_skills where program_id = $1
     union
     select cs.skill_id from app.program_courses pc join app.course_skills cs on cs.course_id = pc.course_id
     where pc.program_id = $1`,
    [programId],
  );
  return rows.map((r) => r.skill_id);
}

export async function benchmark(occ: string) {
  return q<{ skill_id: string; name: string; weight: number; posting_count: number; is_software: boolean }>(
    `select b.skill_id, s.name, b.weight, b.posting_count, coalesce(s.is_software, false) as is_software
     from app.benchmark_skills b join app.skills s on s.id = b.skill_id
     where b.occ_code = $1 and b.geo_code = $2 and b.period_start = $3
     order by b.weight desc, s.name`,
    [occ, GEO, PERIOD],
  );
}

export function coverage(bench: { skill_id: string; weight: number }[], taught: Set<string>) {
  const total = bench.reduce((s, b) => s + b.weight, 0);
  const hit = bench.filter((b) => taught.has(b.skill_id)).reduce((s, b) => s + b.weight, 0);
  return total ? Math.round((100 * hit) / total) : 0;
}

async function postings(occ: string) {
  const row = await one<{ unique_postings: number; median_salary: number | null } | undefined>(
    `select unique_postings, median_salary from app.posting_metrics
     where occ_code = $1 and geo_code = $2 and period_start = $3 limit 1`,
    [occ, GEO, PERIOD],
  );
  return row ?? { unique_postings: 0, median_salary: null };
}

export async function programStats(programId: string) {
  return one<{
    alumni: number;
    matched: number;
    in_field: number;
    in_field_known: number;
    median_wage: number | null;
    wage_n: number;
    region: number;
    region_known: number;
  }>(
    `select count(*)::int as alumni,
            count(*) filter (where has_employment)::int as matched,
            count(*) filter (where in_field)::int as in_field,
            count(*) filter (where in_field is not null)::int as in_field_known,
            percentile_cont(0.5) within group (order by wage_amount) filter (where wage_period = 'year') as median_wage,
            count(*) filter (where wage_period = 'year')::int as wage_n,
            count(*) filter (where resides_in_region)::int as region,
            count(*) filter (where resides_in_region is not null)::int as region_known
     from app.alumni where program_id = $1`,
    [programId],
  );
}

async function timeToJob(programId: string) {
  return one<{ n: number; within6: number; median: number | null; slow: number }>(
    `select count(*)::int as n, count(*) filter (where months <= 6)::int as within6,
            percentile_cont(0.5) within group (order by months) as median,
            count(*) filter (where months > 12)::int as slow
     from app.alumni_time_to_job where program_id = $1`,
    [programId],
  );
}

const COHORTS = ["2011–15", "2016–19", "2020–25"] as const;

/** In-field share by graduating class. Always returns all three classes (known = 0 when a class is empty). */
async function cohorts(programId: string) {
  const rows = await q<{ cohort: string; in_field: number; known: number }>(
    `select case when graduation_year <= 2015 then '2011–15' when graduation_year <= 2019 then '2016–19' else '2020–25' end as cohort,
            count(*) filter (where in_field)::int as in_field, count(*) filter (where in_field is not null)::int as known
     from app.alumni where program_id = $1 and graduation_year is not null group by 1 order by 1`,
    [programId],
  );
  return COHORTS.map((c) => {
    const r = rows.find((x) => x.cohort === c) ?? { cohort: c, in_field: 0, known: 0 };
    return { ...r, pct: pct(r.in_field, r.known) };
  });
}

/* ---------------------------------------------------------------- change catalog */

export type Change = {
  id: string;
  /** Short label for the coverage what-if ("+ ECON 270"). */
  label: string;
  short: string;
  title: string;
  detail: string;
  effort: string;
  skills: string[];
  defaultOn: boolean;
  courses: { edited: number; added: number };
  placement?: boolean;
  /** One-line cost note for the board packet. */
  cost: string;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Generic change package for a program, from its biggest skill gaps against its target occupation:
 *   - a gap some NSSU course already teaches → "Add <code> <name> as an approved elective" (REUSE · LOW);
 *   - a gap nothing on campus teaches → "Add a <skill> unit to <the program's most relevant required course>" (EDIT · MEDIUM);
 *   - plus internships with the employers that hire the most of the program's in-field grads.
 * The two largest gaps are on by default. Reuse changes come first, then edits.
 */
async function changeCatalog(programId: string, info: ProgramInfo, occ: Occupation) {
  const [bench, taughtArr, post] = await Promise.all([benchmark(occ.code), taughtSkillIds(programId), postings(occ.code)]);
  const taught = new Set(taughtArr);
  const gaps = bench.filter((b) => !taught.has(b.skill_id)).slice(0, 3);
  const graduate = info.level === "master";

  // Candidate courses per gap: same level as the degree first, then the course the most programs already
  // share (so seats and approvals exist), then the lowest course number.
  const candidates = await q<{ skill_id: string; id: string; code: string; name: string; programs: number }>(
    `select cs.skill_id, c.id, c.code, c.name, (select count(distinct pc.program_id) from app.program_courses pc where pc.course_id = c.id)::int as programs
     from app.course_skills cs join app.courses c on c.id = cs.course_id
     where c.institution_id = $1 and cs.skill_id = any($2)
       and c.id not in (select course_id from app.program_courses where program_id = $3)`,
    [INSTITUTION, gaps.map((g) => g.skill_id), programId],
  );
  const num = (code: string) => Number(/(\d+)/.exec(code)?.[1] ?? 0);
  const levelOk = (code: string) => (graduate ? num(code) >= 500 : num(code) < 500);
  const best = (skill: string) =>
    candidates
      .filter((c) => c.skill_id === skill)
      .sort((a, b) => Number(levelOk(b.code)) - Number(levelOk(a.code)) || b.programs - a.programs || num(a.code) - num(b.code) || a.code.localeCompare(b.code))[0];

  // Where an EDIT lands: the program's most relevant required course. Software skills go to a data or
  // analytics course when there is one; otherwise the program's home subject (its most common prefix),
  // then the course with the most job-relevant skills, then the more advanced course.
  const required = await q<{ id: string; code: string; name: string; weight: number }>(
    `select c.id, c.code, c.name, coalesce(sum(b.weight), 0)::float as weight
     from app.program_courses pc join app.courses c on c.id = pc.course_id
     left join app.course_skills cs on cs.course_id = c.id
     left join app.benchmark_skills b on b.skill_id = cs.skill_id and b.occ_code = $2 and b.geo_code = $3 and b.period_start = $4
     where pc.program_id = $1 and pc.is_required group by c.id, c.code, c.name`,
    [programId, occ.code, GEO, PERIOD],
  );
  const prefix = (code: string) => code.split(" ")[0];
  const counts = new Map<string, number>();
  required.forEach((c) => counts.set(prefix(c.code), (counts.get(prefix(c.code)) ?? 0) + 1));
  const home = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const techy = /analytic|data|information|quantitative|statistic|digital|media|technolog|systems|computing/i;
  const editTarget = (software: boolean) =>
    [...required].sort(
      (a, b) =>
        (software ? Number(techy.test(b.name)) - Number(techy.test(a.name)) : 0) ||
        Number(prefix(b.code) === home) - Number(prefix(a.code) === home) ||
        b.weight - a.weight ||
        num(b.code) - num(a.code),
    )[0];

  const courseSkillRows = await q<{ course_id: string; skill_id: string }>(`select course_id, skill_id from app.course_skills where course_id = any($1)`, [
    candidates.map((c) => c.id),
  ]);
  const skillsOf = (courseId: string) => courseSkillRows.filter((r) => r.course_id === courseId).map((r) => r.skill_id);
  const jobs = roleWord(occ.name);

  const reuse: Change[] = [];
  const edits: Change[] = [];
  gaps.forEach((g, i) => {
    const course = best(g.skill_id);
    const on = i < 2;
    if (course) {
      reuse.push({
        id: `reuse-${slug(course.code)}`,
        label: `+ ${course.code}`,
        short: `Approve ${course.code} as a major elective`,
        title: `Add ${course.code} ${course.name} as an approved elective`,
        detail: `Teaches ${g.name} (${g.posting_count} postings). Already taught at NSSU — no new course needed.`,
        effort: "REUSE · LOW",
        skills: skillsOf(course.id),
        defaultOn: on,
        courses: { edited: 0, added: 0 },
        cost: "no cost (existing seats)",
      });
    } else {
      const target = editTarget(g.is_software);
      const where = target ? `${target.code} ${target.name}` : `a required ${shortName(info.name)} course`;
      edits.push({
        id: `edit-${slug(g.name)}`,
        label: `+ ${g.name} unit`,
        short: `Add a ${g.name} unit to ${target?.code ?? "a required course"}`,
        title: `Add a 3-week ${g.name} unit to ${where}`,
        detail: `${g.name} appears in ${g.posting_count} of ${post.unique_postings} ${jobs} postings. No course on campus teaches it today.`,
        effort: "EDIT · MEDIUM",
        skills: [g.skill_id],
        defaultOn: on,
        courses: { edited: 1, added: 0 },
        cost: "1 faculty summer stipend",
      });
    }
  });

  const employers = await q<{ employer: string; n: number }>(
    `select employer, count(*) filter (where in_field)::int as n from app.alumni
     where program_id = $1 and employer is not null group by 1 having count(*) filter (where in_field) > 0
     order by n desc, employer limit 2`,
    [programId],
  );
  const internship: Change = {
    id: "internship",
    label: "Internships",
    short: `Launch internships with employers who hire our grads`,
    title: `${cap(roleWord(occ.name))} internships with employers who already hire your grads`,
    detail: employers.length
      ? `${employers.map((e) => `${e.employer} (${e.n} in-field grads)`).join(", ")} already hire${employers.length === 1 ? "s" : ""} your grads in the field.`
      : "No employer on record has hired an in-field grad yet; start with career services’ employer list.",
    effort: "NEW · MEDIUM",
    skills: [],
    defaultOn: employers.length > 0,
    courses: { edited: 0, added: 0 },
    placement: true,
    cost: "career services time",
  };
  const changes = [...reuse, ...edits, internship];
  const defaults = new Set(taughtArr);
  changes.filter((c) => c.defaultOn).forEach((c) => c.skills.forEach((s) => defaults.add(s)));
  return { bench, taught: taughtArr, post, gaps, changes, coverage: coverage(bench, taught), possible: coverage(bench, defaults) };
}

/* ------------------------------------------------------------------ home */

/** Dashboard rows. Stage labels are placeholders until an activity exists for the program (see home.tsx). */
const HOME_PROGRAMS: { id: string; stage: string }[] = [
  { id: "program-north-sound-state-business-bachelor", stage: "In review" },
  { id: "program-north-sound-state-marketing-bachelor", stage: "Needs attention" },
  { id: "program-north-sound-state-supply-bachelor", stage: "Needs attention" },
  { id: "program-north-sound-state-accounting-bachelor", stage: "Monitoring" },
  { id: "program-north-sound-state-business-master", stage: "Survey live" },
];

export async function homeData(featured: string) {
  const programs = await Promise.all(
    HOME_PROGRAMS.map(async (p) => {
      const [prog, stats, align, targets] = await Promise.all([
        one<{ name: string }>(`select name from app.programs where id = $1`, [p.id]),
        programStats(p.id),
        one<{ score: number }>(`select max(score) as score from app.alignment where program_id = $1 and geo_code = $2 and period_start = $3`, [p.id, GEO, PERIOD]),
        // Shortest name first keeps the row subtitle readable; the full list goes in the tooltip.
        q<{ name: string }>(
          `select o.name from app.program_targets t join app.occupations o on o.code = t.occ_code
           where t.program_id = $1 order by length(o.name), o.name`,
          [p.id],
        ),
      ]);
      return {
        ...p,
        name: prog.name,
        alumni: stats.alumni,
        target: targets[0]?.name ?? "",
        targets: targets.map((t) => t.name),
        coverage: Math.round((align?.score ?? 0) * 100),
        inField: stats.in_field,
        inFieldKnown: stats.in_field_known,
      };
    }),
  );
  const totals = await one<{ programs: number }>(`select count(*)::int as programs from app.programs where institution_id = $1 and cip_code like '52.%'`, [INSTITUTION]);
  const [info, occ, stats] = await Promise.all([programInfo(featured), targetOccupation(featured), programStats(featured)]);
  const cat = await changeCatalog(featured, info, occ);
  const reuse = cat.changes.filter((c) => c.defaultOn && c.skills.length).length;
  return {
    programs,
    totals,
    featured: { id: featured, name: info.name, occupation: occ.name, alumni: stats.alumni, changes: reuse },
    coverageNow: cat.coverage,
    coveragePossible: cat.possible,
    postings: cat.post.unique_postings,
  };
}

/* --------------------------------------------------------- review: shared */

/** Header facts for the review layout: program, target occupation and survey audience. */
export async function reviewSurveyFrame(programId: string) {
  const [frame, info, occ] = await Promise.all([
    one<{ alumni: number; reachable: number; employers: number }>(
      `select count(*)::int as alumni, count(*) filter (where has_email)::int as reachable,
              count(distinct employer)::int as employers
       from app.alumni where program_id = $1`,
      [programId],
    ),
    programInfo(programId),
    targetOccupation(programId),
  ]);
  return { ...frame, programId, program: info.name, occupation: occ.name };
}

/* --------------------------------------------------------- review: sync */

/** What the school's systems hold, NSSU-wide (onboarding's connect and sync steps). `program` is optional context. */
export async function syncData(programId?: string) {
  const r = await one<{ alumni: number; location: number; job: number; email: number; wage: number; employers: number }>(
    `select count(*)::int as alumni,
            count(*) filter (where has_location)::int as location,
            count(*) filter (where has_employment)::int as job,
            count(*) filter (where has_email)::int as email,
            count(*) filter (where wage_amount is not null)::int as wage,
            count(distinct employer)::int as employers
     from app.alumni where institution_id = $1`,
    [INSTITUTION],
  );
  // Sync covers all of NSSU; `program` is the reviewed program's slice, the audience the alumni survey reaches.
  const [courses, programs, wages, titles, lightcast, program, info] = await Promise.all([
    one<{ n: number }>(`select count(*)::int as n from app.courses where institution_id = $1`, [INSTITUTION]),
    one<{ n: number }>(`select count(*)::int as n from app.programs where institution_id = $1`, [INSTITUTION]),
    one<{ min: number; max: number; hourly: number; annual: number }>(
      `select min(wage_amount)::float as min, max(wage_amount)::float as max,
              count(*) filter (where wage_period = 'hour')::int as hourly,
              count(*) filter (where wage_period = 'year')::int as annual
       from app.alumni where institution_id = $1 and wage_amount is not null`,
      [INSTITUTION],
    ),
    one<{ titles: number; occs: number; no_job: number }>(
      `select count(distinct job_title)::int as titles, count(distinct occ_code)::int as occs,
              count(*) filter (where not coalesce(has_employment, false))::int as no_job
       from app.alumni where institution_id = $1`,
      [INSTITUTION],
    ),
    one<{ occupations: number; counties: number; first: string; last: string }>(
      `select (select count(*) from app.occupations)::int as occupations,
              count(distinct geo_code)::int as counties, min(period_start) as first, max(period_start) as last
       from app.posting_metrics`,
    ),
    programId
      ? one<{ alumni: number; no_job: number }>(
          `select count(*)::int as alumni, count(*) filter (where not coalesce(has_employment, false))::int as no_job
           from app.alumni where program_id = $1`,
          [programId],
        )
      : null,
    programId ? programInfo(programId) : null,
  ]);
  return {
    ...r,
    courses: courses.n,
    programs: programs.n,
    wages,
    titles,
    lightcast,
    program: program && info ? { ...program, name: info.name, short: shortName(info.name) } : null,
  };
}

/* ------------------------------------------------------ review: explore */

export async function exploreData(programId: string) {
  const [info, occ] = await Promise.all([programInfo(programId), targetOccupation(programId)]);
  const [cat, stats, occs, coh, ttj, reach] = await Promise.all([
    changeCatalog(programId, info, occ),
    programStats(programId),
    q<{ name: string; code: string; n: number }>(
      `select occ_name as name, occ_code as code, count(*)::int as n from app.alumni
       where program_id = $1 and has_employment group by 1, 2 order by n desc, name`,
      [programId],
    ),
    cohorts(programId),
    timeToJob(programId),
    one<{ n: number }>(
      `select count(*)::int as n from app.alumni
       where program_id = $1 and not coalesce(has_employment, false) and (has_email or has_linkedin)`,
      [programId],
    ),
  ]);
  const [peerStats, peerTtj, peerName] = info.peerId
    ? await Promise.all([
        programStats(info.peerId),
        timeToJob(info.peerId),
        one<{ name: string }>(`select i.name from app.institutions i where i.id = $1`, [PEER_INSTITUTION]),
      ])
    : [null, null, null];
  const taught = new Set(cat.taught);
  const top = occs.slice(0, 3);
  const other = occs.slice(3).reduce((s, o) => s + o.n, 0);
  return {
    cohorts: coh,
    peer: info.peerId && peerStats && peerTtj ? { name: peerName?.name ?? "Willow Creek College", stats: peerStats, ttj: peerTtj } : null,
    ttj,
    unmatchedReachable: reach.n,
    program: { name: info.name, short: shortName(info.name), cip_code: info.cip_code, courses: info.courses },
    occupation: occ,
    coverage: cat.coverage,
    possible: cat.possible,
    stats,
    postings: cat.post,
    demand: cat.bench.slice(0, 8).map((b) => ({ ...b, taught: taught.has(b.skill_id) })),
    landing: [...top.map((o) => ({ name: o.name, n: o.n, target: o.code === occ.code })), ...(other ? [{ name: "Other roles", n: other, target: false }] : [])],
    /** Matched alumni working in the target occupation (whether or not it's among the top landing roles). */
    targetHolders: occs.find((o) => o.code === occ.code)?.n ?? 0,
    unmatched: stats.alumni - stats.matched,
    reuseChanges: cat.changes.filter((c) => c.defaultOn && c.skills.length).map((c) => c.label.replace(/^\+ /, "")),
  };
}

/* ----------------------------------------------------- review: diagnose */

export async function diagnoseData(programId: string) {
  const [info, occ] = await Promise.all([programInfo(programId), targetOccupation(programId)]);
  const [cat, stats, offTrack, concentrations, transfer, ttj] = await Promise.all([
    changeCatalog(programId, info, occ),
    programStats(programId),
    // Grads in the two most common jobs other than the target occupation.
    q<{ name: string; n: number }>(
      `select occ_name as name, count(*)::int as n from app.alumni
       where program_id = $1 and has_employment and occ_code is distinct from $2 and occ_name is not null
       group by 1 order by n desc, name limit 2`,
      [programId, occ.code],
    ),
    q<{ name: string; score: number }>(
      `select p.name, max(a.score) as score from app.programs p join app.alignment a on a.program_id = p.id
       where p.id like $1 and a.geo_code = $2 and a.period_start = $3
       group by p.name order by p.name`,
      [`${programId}%`, GEO, PERIOD],
    ),
    // School-wide lead (not program-specific): NSSU alumni who started at Spokane Valley CC.
    one<{ n: number }>(
      `select count(distinct a.id)::int as n from app.alumni a
       join app.education_history h on h.alumni_id = a.id and h.seq = 1
       where a.institution_id = $1 and h.institution_id = 'spokane-valley-cc'`,
      [INSTITUTION],
    ),
    timeToJob(programId),
  ]);
  const gaps = cat.gaps.slice(0, 2);
  const [campus, gapCourses] = await Promise.all([
    one<{ n: number }>(`select count(*)::int as n from app.courses where institution_id = $1`, [INSTITUTION]),
    q<{ skill_id: string; n: number }>(
      `select cs.skill_id, count(distinct c.id)::int as n from app.course_skills cs join app.courses c on c.id = cs.course_id
       where c.institution_id = $1 and cs.skill_id = any($2) group by 1`,
      [INSTITUTION, gaps.map((g) => g.skill_id)],
    ),
  ]);
  return {
    program: { name: info.name, short: shortName(info.name) },
    occupation: occ,
    campusCourses: campus.n,
    programCourses: info.courses,
    taughtSkills: cat.taught.length,
    gapCourses: Object.fromEntries(gapCourses.map((g) => [g.skill_id, g.n])) as Record<string, number>,
    stats,
    offTrack: offTrack.reduce((s, o) => s + o.n, 0),
    offTrackJobs: offTrack.map((o) => o.name),
    concentrations: concentrations.map((c) => ({ name: c.name, score: Math.round(c.score * 100) })),
    gaps,
    coverage: cat.coverage,
    possible: cat.possible,
    transfer: transfer.n,
    marketMedian: cat.post.median_salary,
    postings: cat.post.unique_postings,
    ttj,
  };
}

/* -------------------------------------------------------- review: build */

export async function buildData(programId: string) {
  const [info, occ] = await Promise.all([programInfo(programId), targetOccupation(programId)]);
  const [cat, credits] = await Promise.all([
    changeCatalog(programId, info, occ),
    one<{ required: number }>(
      `select coalesce(sum(c.credits), 0)::float as required from app.program_courses pc join app.courses c on c.id = pc.course_id
       where pc.program_id = $1 and pc.is_required`,
      [programId],
    ),
  ]);
  return {
    program: { name: info.name, short: shortName(info.name) },
    occupation: occ,
    requiredCredits: credits.required,
    bench: cat.bench,
    taught: cat.taught,
    postings: cat.post.unique_postings,
    changes: cat.changes,
  };
}

/* -------------------------------------------------------- outcomes: say */

export async function sayData(programId: string) {
  const occ = await targetOccupation(programId);
  const [info, stats, coh, ttjBuckets, ttj, loc, employers, topOcc, market] = await Promise.all([
    programInfo(programId),
    programStats(programId),
    cohorts(programId),
    q<{ bucket: string; n: number }>(
      `select case when months <= 3 then '0–3' when months <= 6 then '4–6' when months <= 12 then '7–12' else '12+' end as bucket,
              count(*)::int as n from app.alumni_time_to_job where program_id = $1 group by 1`,
      [programId],
    ),
    timeToJob(programId),
    one<{ region: number; elsewhere: number; abroad: number; unknown: number }>(
      `select count(*) filter (where resides_in_region)::int as region,
              count(*) filter (where has_location and not is_international and not coalesce(resides_in_region, false))::int as elsewhere,
              count(*) filter (where is_international)::int as abroad,
              count(*) filter (where not has_location)::int as unknown
       from app.alumni where program_id = $1`,
      [programId],
    ),
    q<{ employer: string; n: number }>(
      `select employer, count(*)::int as n from app.alumni where program_id = $1 and employer is not null
       group by 1 having count(*) >= 5 order by n desc, employer limit 4`,
      [programId],
    ),
    one<{ name: string; n: number } | undefined>(
      `select occ_name as name, count(*)::int as n from app.alumni where program_id = $1 and has_employment and occ_name is not null
       group by 1 order by n desc, name limit 1`,
      [programId],
    ),
    postings(occ.code),
  ]);
  const order = ["0–3", "4–6", "7–12", "12+"];
  const fast = ttjBuckets.find((b) => b.bucket === "0–3")?.n ?? 0;
  return {
    program: { id: programId, name: info.name, short: shortName(info.name) },
    occupation: occ,
    /** King County 2024 median advertised salary for the target occupation. */
    marketMedian: market.median_salary,
    stats,
    cohorts: coh,
    ttjBuckets: order.map((b) => ({ bucket: b, n: ttjBuckets.find((x) => x.bucket === b)?.n ?? 0 })),
    ttj,
    within3: pct(fast, ttj.n),
    loc,
    employers,
    topOcc: topOcc ?? null,
  };
}

/* ----------------------------------------------------- outcomes: deeper */

const STAGES = ["0–3 years", "4–7 years", "8–15 years"] as const;
type Group = { n: number; median: number | null };
const none: Group = { n: 0, median: null };

export async function deeperData(programId: string) {
  const occ = await targetOccupation(programId);
  const [byStage, field, local, ref, slow, unknown] = await Promise.all([
    q<{ stage: string; n: number; median: number }>(
      `select case when $2 - graduation_year <= 3 then '0–3 years' when $2 - graduation_year <= 7 then '4–7 years' else '8–15 years' end as stage,
              count(*)::int as n, percentile_cont(0.5) within group (order by wage_amount) as median
       from app.alumni where program_id = $1 and occ_code = $3 and wage_period = 'year' and graduation_year is not null
       group by 1 order by 1`,
      [programId, DATA_YEAR, occ.code],
    ),
    q<{ in_field: boolean; n: number; median: number }>(
      `select in_field, count(*)::int as n, percentile_cont(0.5) within group (order by wage_amount) as median
       from app.alumni where program_id = $1 and wage_period = 'year' and in_field is not null group by 1`,
      [programId],
    ),
    q<{ local: boolean; n: number; median: number }>(
      `select coalesce(resides_in_region, false) as local, count(*)::int as n,
              percentile_cont(0.5) within group (order by wage_amount) as median
       from app.alumni where program_id = $1 and wage_period = 'year' and in_field and has_location group by 1`,
      [programId],
    ),
    // The occupation's typical pay as carried on the program's own alumni records; any NSSU record for it otherwise.
    one<{ median: number | null; p10: number | null; p90: number | null }>(
      `select coalesce(max(occ_median_wage) filter (where program_id = $2), max(occ_median_wage)) as median,
              coalesce(max(occ_p10_wage) filter (where program_id = $2), max(occ_p10_wage)) as p10,
              coalesce(max(occ_p90_wage) filter (where program_id = $2), max(occ_p90_wage)) as p90
       from app.alumni where occ_code = $1 and occ_median_period = 'year'`,
      [occ.code, programId],
    ),
    one<{ n: number; now_target: number; now_in_field: number; now_out: number; now_unknown: number; from2020: number }>(
      `select count(*)::int as n, count(*) filter (where a.occ_code = $2)::int as now_target,
              count(*) filter (where a.in_field)::int as now_in_field,
              count(*) filter (where a.has_employment and not coalesce(a.in_field, false))::int as now_out,
              count(*) filter (where not a.has_employment)::int as now_unknown,
              count(*) filter (where a.graduation_year between 2020 and 2022)::int as from2020
       from app.alumni_time_to_job t join app.alumni a on a.id = t.alumni_id
       where t.program_id = $1 and t.months > 12`,
      [programId, occ.code],
    ),
    one<{ n: number; reachable: number; email: number; linkedin: number; linkedin_only: number; no_contact: number }>(
      `select count(*)::int as n, count(*) filter (where has_email or has_linkedin)::int as reachable,
              count(*) filter (where has_email)::int as email,
              count(*) filter (where has_linkedin)::int as linkedin,
              count(*) filter (where has_linkedin and not has_email)::int as linkedin_only,
              count(*) filter (where not has_email and not has_linkedin)::int as no_contact
       from app.alumni where program_id = $1 and not has_employment`,
      [programId],
    ),
  ]);
  const [stats, ttj, fast, slowHires, unknownByClass, targetEmployers] = await Promise.all([
    programStats(programId),
    timeToJob(programId),
    one<{ n: number }>(`select count(*)::int as n from app.alumni_time_to_job where program_id = $1 and months <= 3`, [programId]),
    // One row per grad who took 12+ months to a first job (no names, just months, class and current job).
    q<{ months: number; graduation_year: number; status: "target" | "in_field" | "out" | "unknown" }>(
      `select t.months, a.graduation_year,
              case when not a.has_employment then 'unknown' when a.occ_code = $2 then 'target'
                   when a.in_field then 'in_field' else 'out' end as status
       from app.alumni_time_to_job t join app.alumni a on a.id = t.alumni_id
       where t.program_id = $1 and t.months > 12 order by t.months`,
      [programId, occ.code],
    ),
    q<{ cohort: string; n: number }>(
      `select case when graduation_year is null then 'Did not complete' when graduation_year <= 2015 then '2011–15'
                   when graduation_year <= 2019 then '2016–19' else '2020–25' end as cohort, count(*)::int as n
       from app.alumni where program_id = $1 and not has_employment group by 1 order by 1`,
      [programId],
    ),
    q<{ employer: string; target: number; grads: number }>(
      `select employer, count(*) filter (where occ_code = $2)::int as target, count(*)::int as grads
       from app.alumni where program_id = $1 and employer is not null
       group by 1 order by target desc, grads desc, employer limit 2`,
      [programId, occ.code],
    ),
  ]);
  return {
    occupation: occ,
    ttjN: ttj.n,
    /** Share of grads with job dates hired within 3 months (same basis as sayData().within3). */
    within3: pct(fast.n, ttj.n),
    slowHires,
    unknownByClass,
    targetEmployers: targetEmployers.filter((e) => e.target > 0),
    /** Always all three career stages; n = 0 and median = null where there is nobody. */
    byStage: STAGES.map((s) => byStage.find((b) => b.stage === s) ?? { stage: s, ...none }) as { stage: string; n: number; median: number | null }[],
    inField: (field.find((f) => f.in_field) ?? none) as Group,
    outField: (field.find((f) => !f.in_field) ?? none) as Group,
    local: (local.find((l) => l.local) ?? none) as Group,
    away: (local.find((l) => !l.local) ?? none) as Group,
    ref,
    slow,
    unknown,
    stats,
    wageMedian: stats.median_wage,
  };
}

/* -------------------------------------------------------- outcomes: claims */

export type Claim = { claim: string; value: string; count: number | null; n: number; note: string; source: string };

/** Every claim the story makes, with its count and denominator. Claims with no data behind them are left out. */
export async function storyClaims(programId: string) {
  const [say, deep] = await Promise.all([sayData(programId), deeperData(programId)]);
  const recent = say.cohorts.find((c) => c.cohort === "2020–25")!;
  const [early, mid, late] = deep.byStage;
  const k = (v: number) => `$${Math.round(v / 1000)}k`;
  const within3 = say.ttjBuckets.find((b) => b.bucket === "0–3")?.n ?? 0;
  const repeat = say.employers.filter((e) => e.n >= 7);
  const wage = "alumni-record.json · employment.estimatedWage (annual)";
  const exact = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
  const stage = "Different grads at each stage, not the same people over time";
  const role = deep.occupation.name.toLowerCase();
  const claims: Claim[] = [];
  if (recent.known) {
    claims.push({ claim: "2020–25 grads working in their field", value: `${recent.pct}%`, count: recent.in_field, n: recent.known, note: "Share of 2020–25 grads with a known job", source: "alumni-record.json · employment.employedInField" });
  }
  if (say.topOcc) {
    claims.push({ claim: `Grads working as ${say.topOcc.name.toLowerCase()}`, value: String(say.topOcc.n), count: say.topOcc.n, n: say.stats.matched, note: "Count of alumni with a known job", source: "alumni-record.json · employment.occupation" });
  }
  if (say.ttj.n) {
    claims.push({ claim: "Hired within 3 months of graduating", value: `${say.within3}%`, count: within3, n: say.ttj.n, note: `Median ${say.ttj.median} months; graduation assumed in June`, source: "alumni-record.json · careerEvents.startDate" });
  }
  for (const [s, label] of [
    [early, "0–3"],
    [mid, "4–7"],
    [late, "8–15"],
  ] as const) {
    if (!s.n || s.median == null) continue;
    claims.push({ claim: `${deep.occupation.name} median pay, ${label} years after graduating`, value: k(s.median), count: null, n: s.n, note: `${stage}${s.n < SMALL_N ? "; small group" : ""}; exact median ${exact(s.median)}`, source: wage });
  }
  if (repeat.length) {
    claims.push({ claim: "Employers who hired 7+ of our grads", value: String(repeat.length), count: repeat.reduce((s, e) => s + e.n, 0), n: say.stats.matched, note: `Current employer; ${repeat.map((e) => `${e.employer} ${e.n}`).join(", ")}`, source: "alumni-record.json · employment.employer" });
  }
  claims.push({ claim: "Alumni with no job on record", value: String(deep.unknown.n), count: deep.unknown.n, n: deep.stats.alumni, note: `Outcomes still being collected; ${deep.unknown.reachable} reachable by email or LinkedIn`, source: "alumni-record.json · employment, contact" });
  return {
    say,
    deep,
    role,
    headline: recent.known >= SMALL_N ? `${recent.pct}% of our recent grads work in their field.` : say.stats.matched ? `${pct(say.stats.in_field, say.stats.in_field_known)}% of our grads with a known job work in their field.` : "Our outcomes story starts with collecting data.",
    claims,
  };
}

/** Counts for the Outcomes story stage bar. */
export async function outcomesHeader(programId: string) {
  const [info, stats, programs, slow] = await Promise.all([
    programInfo(programId),
    programStats(programId),
    one<{ n: number }>(`select count(*)::int as n from app.programs where institution_id = $1 and cip_code like '52.%'`, [INSTITUTION]),
    one<{ n: number }>(`select count(*)::int as n from app.alumni_time_to_job where program_id = $1 and months > 12`, [programId]),
  ]);
  return {
    program: { id: programId, name: info.name, short: shortName(info.name) },
    programs: programs.n,
    alumni: stats.alumni,
    matched: stats.matched,
    unknown: stats.alumni - stats.matched,
    slow: slow.n,
    median: stats.median_wage,
  };
}
