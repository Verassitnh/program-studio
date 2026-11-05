-- Program Studio workspace pages: Surveys, Integrations, Exports and Account settings.
-- Lives in the `studio` schema next to db/studio.sql, so `npm run db:import` never touches it.
-- Idempotent: applied lazily by app/lib/workspace.server.ts (once per process) and by the import/sync
-- scripts, which apply every db/studio*.sql file. Never drop or rename anything here; only add.

create schema if not exists studio;

-- One outreach survey per program x audience. Closed surveys stay as history; a new wave is a new row.
create table if not exists studio.surveys (
  id            bigserial primary key,
  program_id    text not null,
  audience      text not null check (audience in ('employers', 'alumni')),
  template      text not null,
  status        text not null default 'draft' check (status in ('draft', 'scheduled', 'sent', 'closed')),
  wave          int not null default 1,
  -- Optional link to studio.activities(id). No foreign key: this file may run before db/studio.sql.
  activity_id   uuid,
  -- Recipient count frozen when the survey is sent (drafts show the live count from app.alumni).
  recipients    int,
  scheduled_for timestamptz,
  sent_at       timestamptz,
  closed_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- At most one open (not closed) survey per program and audience.
create unique index if not exists surveys_one_open on studio.surveys (program_id, audience) where status <> 'closed';
create index if not exists surveys_recent on studio.surveys (updated_at desc);

-- Send timeline: created, scheduled, unscheduled, sent, reminded, closed, duplicated.
create table if not exists studio.survey_events (
  id        bigserial primary key,
  survey_id bigint not null references studio.surveys (id) on delete cascade,
  at        timestamptz not null default now(),
  type      text not null,
  data      jsonb not null default '{}'
);
create index if not exists survey_events_by_survey on studio.survey_events (survey_id, at);

-- Simulated connector state for the Integrations page. "Connected" here moves no data.
create table if not exists studio.integrations (
  key          text primary key,
  connected    boolean not null default false,
  connected_at timestamptz,
  updated_at   timestamptz not null default now()
);

-- Quick exports downloaded from /exports without an activity.
create table if not exists studio.exports (
  id         bigserial primary key,
  program_id text not null,
  kind       text not null check (kind in ('outcomes', 'alignment')),
  format     text not null default 'csv',
  artifact   text not null,
  rows       int,
  created_at timestamptz not null default now()
);
create index if not exists exports_recent on studio.exports (created_at desc);

-- Workspace preferences (Account page). One row per key; values are JSON.
create table if not exists studio.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
insert into studio.settings (key, value) values ('small_sample_n', '10'), ('target_region', '"53033"')
on conflict (key) do nothing;
