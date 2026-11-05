-- Program Studio surveys: questions, recipients (one private link each), responses and answers, plus the
-- function that turns real job answers into outcome corrections at sync time.
--
-- Named so it sorts AFTER db/studio-workspace.sql (it extends studio.surveys from that file); the import and
-- sync pipeline applies every db/studio*.sql in sorted order, and app/lib/surveys.server.ts applies it lazily.
-- Idempotent: `create … if not exists` / `create or replace` / `add column if not exists`. Never drop here.

create schema if not exists studio;

-- The invitation (subject, intro, sender name) and whether the template questions were seeded yet.
alter table studio.surveys add column if not exists message jsonb not null default '{}';
alter table studio.surveys add column if not exists questions_seeded boolean not null default false;
-- "Duplicate as new version": the survey this one was copied from.
alter table studio.surveys add column if not exists version_of bigint;

-- Ordered questions. `key` is stable across edits; answers and skip logic refer to it.
--   type     single | multi | scale | nps | yesno | short | long | job | skills
--   options  per type: {choices:[{id,label}], other}, {min,max,minLabel,maxLabel}, {placeholder}, …
--   logic    {skip_if: {question: <key>, answer: <choice id | 'yes' | 'no' | 'not_employed'>}} or null
create table if not exists studio.survey_questions (
  id         bigserial primary key,
  survey_id  bigint not null references studio.surveys (id) on delete cascade,
  key        text not null,
  position   int not null,
  type       text not null check (type in ('single', 'multi', 'scale', 'nps', 'yesno', 'short', 'long', 'job', 'skills')),
  prompt     text not null default '',
  help       text not null default '',
  required   boolean not null default false,
  options    jsonb not null default '{}',
  logic      jsonb,
  updated_at timestamptz not null default now(),
  unique (survey_id, key)
);
create index if not exists survey_questions_order on studio.survey_questions (survey_id, position);

-- Who a survey goes to: real alumni (with an email on file) or the distinct employers of a program's grads,
-- snapshotted when the recipient list is first built. `token` is the private link (/s/<token>): 32 random
-- bytes, base64url, created at send. Delivery is SIMULATED: nothing is emailed.
create table if not exists studio.survey_recipients (
  id               bigserial primary key,
  survey_id        bigint not null references studio.surveys (id) on delete cascade,
  kind             text not null check (kind in ('alumni', 'employer')),
  alumni_id        text,
  employer         text,
  label            text not null,
  first_name       text,
  class_year       int,
  job_known        boolean,
  in_field         boolean,
  grads            int,
  included         boolean not null default true,
  token            text unique,
  sent_at          timestamptz,
  opened_at        timestamptz,
  started_at       timestamptz,
  completed_at     timestamptz,
  last_reminded_at timestamptz,
  reminders        int not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists survey_recipients_by_survey on studio.survey_recipients (survey_id);
create unique index if not exists survey_recipients_one_alumnus on studio.survey_recipients (survey_id, alumni_id) where alumni_id is not null;
create unique index if not exists survey_recipients_one_employer on studio.survey_recipients (survey_id, employer) where kind = 'employer';

-- One response per recipient link (real), or a demo response (is_demo, no recipient). Demo rows are
-- SIMULATED: counted apart from real ones and never used for corrections unless demo corrections are on.
create table if not exists studio.survey_responses (
  id           bigserial primary key,
  survey_id    bigint not null references studio.surveys (id) on delete cascade,
  recipient_id bigint references studio.survey_recipients (id) on delete cascade,
  is_demo      boolean not null default false,
  alumni_id    text,
  status       text not null default 'started' check (status in ('started', 'completed')),
  started_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);
create unique index if not exists survey_responses_one_per_recipient on studio.survey_responses (recipient_id) where recipient_id is not null;
create index if not exists survey_responses_by_survey on studio.survey_responses (survey_id, is_demo);

create table if not exists studio.survey_answers (
  response_id  bigint not null references studio.survey_responses (id) on delete cascade,
  question_key text not null,
  value        jsonb not null,
  answered_at  timestamptz not null default now(),
  primary key (response_id, question_key)
);

-- Submitted "Current job" answers that report a job (latest per alumnus). Real responses only, unless
-- `with_demo`. `p_survey` narrows it to one survey (the survey page's "will apply at next sync" count).
create or replace function studio.survey_job_answers(with_demo boolean default false, p_survey bigint default null)
returns table (survey_id bigint, alumni_id text, title text, employer text, start_month text, salary numeric, unit text, related text, is_demo boolean, completed_at timestamptz)
language sql stable as $$
  select distinct on (r.alumni_id)
         r.survey_id, r.alumni_id,
         nullif(trim(a.value->>'title'), ''), nullif(trim(a.value->>'employer'), ''), a.value->>'start',
         case when (a.value->>'salary') ~ '^[0-9]+(\.[0-9]+)?$' then (a.value->>'salary')::numeric end,
         a.value->>'unit', a.value->>'related', r.is_demo, r.completed_at
  from studio.survey_responses r
  join studio.survey_questions q on q.survey_id = r.survey_id and q.type = 'job'
  join studio.survey_answers a on a.response_id = r.id and a.question_key = q.key
  where r.status = 'completed' and r.alumni_id is not null
    and (with_demo or not r.is_demo)
    and (p_survey is null or r.survey_id = p_survey)
    and a.value->>'employed' = 'yes' and nullif(trim(a.value->>'title'), '') is not null
  order by r.alumni_id, r.is_demo, r.completed_at desc
$$;

-- Runs after the app.* transform on every sync (scripts/lib/pipeline.mjs): fills the job of each alumnus
-- with NO job on record who reported one through a survey link. Known jobs are never overwritten. The
-- title is matched to an occupation through titles already on record (else left unmatched, which the
-- data-issue check reports). Returns the number of alumni updated. `npm run db:import` never calls this,
-- so a plain import reverts to the source data.
create or replace function studio.apply_survey_corrections(with_demo boolean default false) returns int
language plpgsql as $$
declare
  n int := 0;
begin
  if to_regclass('app.alumni') is null then
    return 0;
  end if;
  with src as (
    select j.*,
           coalesce(
             (select a2.occ_code from app.alumni a2
               where lower(a2.job_title) = lower(j.title) and a2.occ_code is not null
               group by a2.occ_code order by count(*) desc, a2.occ_code limit 1),
             (select o.code from app.occupations o
               where o.name ilike j.title || '%' or o.name ilike j.title || 's' order by o.code limit 1)) as occ
    from studio.survey_job_answers(with_demo) j
  ),
  up as (
    update app.alumni a
       set has_employment = true,
           employer = coalesce(s.employer, a.employer),
           job_title = s.title,
           occ_code = s.occ,
           occ_name = (select o.name from app.occupations o where o.code = s.occ),
           in_field = case s.related when 'yes' then true when 'no' then false end,
           wage_amount = s.salary,
           wage_period = case when s.salary is null then null when s.unit = 'hour' then 'hour' else 'year' end
      from src s
     where a.id = s.alumni_id and not coalesce(a.has_employment, false)
    returning a.id, s.start_month, s.occ, s.related, s.employer, s.salary, s.unit
  ),
  ev as (
    insert into app.career_events (alumni_id, type, start_date, occ_code, in_field, organization, wage_amount, wage_period)
    select u.id, 'employment', u.start_month || '-01', u.occ,
           case u.related when 'yes' then true when 'no' then false end, u.employer, u.salary,
           case when u.salary is null then null when u.unit = 'hour' then 'hour' else 'year' end
      from up u
     where u.start_month ~ '^[0-9]{4}-[0-9]{2}$'
    returning 1
  )
  select count(*) into n from up;
  return n;
end $$;
