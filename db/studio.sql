-- Program Studio's own state: activities (threads), their event log, and sync history.
-- Lives in its own `studio` schema so `npm run db:import` (which drops raw + app) never touches it.
-- Idempotent: applied by scripts/import.mjs, scripts/sync.mjs and lazily by the server on first use.

create schema if not exists studio;

create table if not exists studio.activities (
  id           uuid primary key default gen_random_uuid(),
  program_id   text not null,
  kind         text not null check (kind in ('review', 'outcomes')),
  status       text not null default 'open' check (status in ('open', 'running', 'closed')),
  stage        text not null,
  title        text not null,
  state        jsonb not null default '{}',
  fingerprint  text,
  issues       jsonb not null default '[]',
  needs_review boolean not null default false,
  opened_at    timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  exported_at  timestamptz,
  closed_at    timestamptz,
  close_reason text check (close_reason in ('manual', 'sync')),
  close_note   text
);
-- Added after the first version shipped; keeps older databases in step.
alter table studio.activities add column if not exists exported_at timestamptz;

create index if not exists activities_recent on studio.activities (updated_at desc);
create index if not exists activities_live on studio.activities (program_id, kind, updated_at desc) where status <> 'closed';

create table if not exists studio.activity_events (
  id          bigserial primary key,
  activity_id uuid not null references studio.activities (id) on delete cascade,
  at          timestamptz not null default now(),
  type        text not null,
  data        jsonb not null default '{}'
);
create index if not exists activity_events_by_activity on studio.activity_events (activity_id, at);
create index if not exists activity_events_by_type on studio.activity_events (type, at desc);

create table if not exists studio.syncs (
  id                    bigserial primary key,
  ran_at                timestamptz not null default now(),
  source                text not null,
  with_demo_corrections boolean not null default false,
  changed_programs      jsonb not null default '[]',
  closed                jsonb not null default '[]',
  flagged               jsonb not null default '[]'
);

-- Fingerprint of everything an activity's numbers depend on: the program's alumni rows plus its
-- curriculum (courses, course skills, program skills). Any corrected record changes the hash.
-- plpgsql so the body is only resolved when called: app.* may not exist yet when this file runs.
create or replace function studio.program_fingerprint(p_program text) returns text
language plpgsql stable as $$
declare
  v text;
begin
  select md5(
    coalesce((select string_agg(row_to_json(a)::text, '|' order by a.id) from app.alumni a where a.program_id = p_program), '') || '#' ||
    coalesce((select string_agg(concat_ws(',', pc.course_id, pc.is_required, c.code, c.name, c.credits), '|' order by pc.course_id)
              from app.program_courses pc left join app.courses c on c.id = pc.course_id where pc.program_id = p_program), '') || '#' ||
    coalesce((select string_agg(pc.course_id || ':' || cs.skill_id, '|' order by pc.course_id, cs.skill_id)
              from app.program_courses pc join app.course_skills cs on cs.course_id = pc.course_id where pc.program_id = p_program), '') || '#' ||
    coalesce((select string_agg(ps.skill_id, '|' order by ps.skill_id) from app.program_skills ps where ps.program_id = p_program), '')
  ) into v;
  return v;
end $$;

-- Open data issues for a program, as [{key, label, count}]. An empty array means the data is clean
-- enough to stand behind: at least 90% of alumni matched to a job (the reporting threshold the
-- dashboard uses), every job matched to an occupation, every job with a wage, wages all annual.
create or replace function studio.program_issues(p_program text) returns jsonb
language plpgsql stable as $$
declare
  r record;
  out jsonb := '[]';
begin
  select count(*)::int as alumni,
         count(*) filter (where not has_employment)::int as no_job,
         count(*) filter (where has_employment and (occ_code is null or in_field is null))::int as unmatched,
         count(*) filter (where has_employment and wage_amount is null)::int as no_wage,
         count(*) filter (where wage_period is not null and wage_period <> 'year')::int as wage_units
    into r from app.alumni where program_id = p_program;
  if r.alumni > 0 and (r.alumni - r.no_job) < ceil(0.9 * r.alumni) then
    out := out || jsonb_build_object('key', 'no_job', 'count', r.no_job,
      'label', r.no_job || ' alumni with no job on record (' || round(100.0 * (r.alumni - r.no_job) / r.alumni) || '% matched; 90% needed)');
  end if;
  if r.unmatched > 0 then
    out := out || jsonb_build_object('key', 'unmatched', 'count', r.unmatched,
      'label', r.unmatched || ' jobs not matched to an occupation');
  end if;
  if r.no_wage > 0 then
    out := out || jsonb_build_object('key', 'no_wage', 'count', r.no_wage,
      'label', r.no_wage || ' jobs with no wage on record');
  end if;
  if r.wage_units > 0 then
    out := out || jsonb_build_object('key', 'wage_units', 'count', r.wage_units,
      'label', r.wage_units || ' wages reported hourly, not annual');
  end if;
  return out;
end $$;

-- Workspace setup (onboarding): connect sources, initial sync and data check, fill gaps with surveys.
-- One row. status: not_started → in_progress → completed, or skipped ("Skip for now"; resumable).
create table if not exists studio.onboarding (
  id               int primary key default 1 check (id = 1),
  status           text not null default 'not_started' check (status in ('not_started', 'in_progress', 'skipped', 'completed')),
  step             text not null default 'connect',
  data             jsonb not null default '{}',
  banner_dismissed boolean not null default false,
  started_at       timestamptz,
  skipped_at       timestamptz,
  completed_at     timestamptz,
  updated_at       timestamptz not null default now()
);
insert into studio.onboarding (id) values (1) on conflict (id) do nothing;

-- Program reviews no longer have data stages (connect, sync and survey moved to onboarding).
-- Activities parked on one of them resume at the first analysis stage.
update studio.activities set stage = 'explore' where kind = 'review' and stage in ('connect', 'sync', 'survey');

-- Four activity kinds (every action the dean takes is a thread with a finish):
--   review, outcomes  analysis of one program
--   survey            one sent survey (ref_id = studio.surveys.id); drafts are not activities
--   sync              one data sync run (ref_id = studio.syncs.id); workspace-level, so no program
alter table studio.activities alter column program_id drop not null;
alter table studio.activities add column if not exists ref_id text;
alter table studio.activities drop constraint if exists activities_kind_check;
alter table studio.activities add constraint activities_kind_check check (kind in ('review', 'outcomes', 'survey', 'sync'));
alter table studio.activities drop constraint if exists activities_close_reason_check;
alter table studio.activities add constraint activities_close_reason_check check (close_reason in ('manual', 'sync', 'finished', 'failed'));
create index if not exists activities_ref on studio.activities (kind, ref_id);
alter table studio.syncs add column if not exists activity_id uuid;

-- Outcomes stories open on the report: the scan stage is gone (programs are picked on Programs) and
-- "say" is now "story".
update studio.activities set stage = 'story' where kind = 'outcomes' and stage in ('scan', 'say');
