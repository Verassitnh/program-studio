# Program Studio

An interview prototype for **Lightcast**: a workspace where an academic dean reviews degree programs against
labor-market demand and alumni outcomes. It is set at a fictional institution, North Sound State University,
and its School of Business.

The first visit runs **workspace setup** (`/onboarding`): connect sources, run the initial sync and data check, and
send surveys to fill the gaps. After that, the dashboard (`/`) lists the school's programs, and everything the dean
does is an **activity**: a thread in the sidebar with a finish (see [Activities](#activities)). Activities open
fullscreen; the ← button at the top left, or <kbd>Esc</kbd>, returns to the dashboard.

- **Program review** (`/a/:id/review/*`): Explore → Diagnose → Build changes → Board packet, for one program.
- **Outcomes story** (`/a/:id/outcomes/*`): opens on the report itself, then Dig deeper → Fix → Export.
- **Survey** (`/a/:id/survey`): one sent survey and its (simulated) responses.
- **Data sync** (`/a/:id/sync`): one sync run and what it changed.

Reviews and stories work for any North Sound State program. Business Administration, B.S. is the default (and the
richest data).

Built with React Router v8 (framework mode, SSR), Tailwind CSS v4, Motion, and Postgres.

## Prerequisites

- **Node.js 20+.** Loading `.env` automatically needs 20.12+. Without it, export `DATABASE_URL` yourself.
- **PostgreSQL 14+** running locally. By default the app connects over the local socket to
  `postgres:///program_studio`, which works out of the box with Homebrew or Postgres.app. Set
  `DATABASE_URL` for anything else (see `.env.example`).

## Setup

```sh
npm install
npm run db:import   # creates the database if needed, loads ./data, builds the app schema (~3s)
npm run dev         # http://localhost:5173 (pass --port to change it)
```

`npm run db:import` is idempotent. Each run drops and rebuilds `raw` and `app` inside one transaction, so you can
re-run it while the dev server is up. It never drops the `studio` schema (activities, surveys, sync history), so a
re-import keeps your work. To start completely fresh, run `dropdb program_studio && npm run db:import`.
The script prints row counts for every raw and app table, then runs a sanity check.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run db:sync` | Re-import, then reconcile open activities and record the run in `studio.syncs` (see [Sync](#sync-and-auto-close)) |
| `npm run db:sync -- --with-demo-corrections` | Same, plus the **simulated** corrections in `data/corrections/*.simulated.json` |
| `npm run typecheck` | `react-router typegen && tsc --noEmit` |
| `npm run build` / `npm start` | Production build, then serve it with `react-router-serve` |

## Database layout

`scripts/import.mjs` (via the shared `scripts/lib/pipeline.mjs`) loads the data in two layers, then applies the
app's own `studio` schema:

- **`raw.*`**: one table per dataset in `./data/*.json` (33 files including `catalog.json`; `*.schema.json`
  files are skipped). Each table is `raw.<dataset>(id serial, record jsonb)` and holds one row per record,
  stored verbatim. Nothing is reshaped here.
- **`app.*`**: normalized tables and views built from `raw.*` by `db/transform.sql`. The app only queries
  this layer. The main relations:
  - `programs`, `program_courses`, `program_skills`, `program_targets`, `courses`, `course_skills`:
    the curriculum
  - `skills`, `occupations`, `geography`, `institutions`: reference data
  - `posting_metrics`, `posting_growth`, `benchmark_skills`, `alignment`: labor-market demand and the
    program-to-occupation alignment scores
  - `alumni` (one row per alumni record, with employment, wage, and location flags), `career_events`,
    `education_history`
  - `alumni_time_to_job` (view): months from graduation to first job

- **`studio.*`**: the app's own state, created by `db/studio*.sql` (`db/studio.sql` first, then add-ons such as
  `db/studio-workspace.sql`). Every statement is `create … if not exists` / `create or replace`, and it is applied
  by import, by sync, and lazily by the server on first use, so a fresh database or a dropped schema heals itself.
  `db/studio.sql` holds:
  - `activities` (`id` uuid, `program_id` (null for syncs), `kind` review|outcomes|survey|sync, `ref_id` (survey id or
    sync id), `status` open|running|closed, `stage`, `title`, `state` jsonb, `fingerprint`, `issues` jsonb,
    `needs_review`, `opened_at`, `updated_at`, `exported_at`, `closed_at`, `close_reason` manual|sync|finished|failed,
    `close_note`)
  - `activity_events` (`activity_id`, `at`, `type`, `data` jsonb): opened, resumed, stage, state, closed, reopened,
    flagged, reviewed, exported, finished, failed
  - `syncs` (`id`, `ran_at`, `source`, `with_demo_corrections`, `changed_programs`, `closed`, `flagged`, `activity_id`)
  - `onboarding` (one row: `status` not_started|in_progress|skipped|completed, `step`, `data`, `banner_dismissed`,
    timestamps)
  - one-time migrations: review activities parked on the old connect/sync/survey stages move to `explore`; outcomes
    activities on `scan`/`say` move to `story`
  - functions `studio.program_fingerprint(program_id)` and `studio.program_issues(program_id)`, shared by the server
    and the sync CLI

Loader queries live in `app/lib/data.server.ts`; every function takes the activity's `programId`. All writes to
`studio.activities` go through `app/lib/activities.server.ts`. The pool is in `app/lib/db.server.ts`.

## Workspace setup

`/onboarding` runs once, before anything else: the shell redirects the first visit to `/` there while setup has
never been started. It is fullscreen with the same stage bar, but it is a guide, not an activity.

1. **Connect sources.** The Lightcast local import (`./data`) is the real source; every other connector is labelled
   simulated.
2. **Sync and check.** The initial sync runs on arrival (the real pipeline, recorded as a sync activity) and shows
   coverage plus an informational data-health summary: alumni with no job, unmatched titles, wage units,
   small-sample programs. Nothing to decide: the gaps become the next step's defaults.
3. **Fill the gaps with surveys.** The programs with the most alumni with no job on record are listed (top five
   picked). **Send surveys & finish** creates and sends them through the Surveys API; each one becomes a survey
   activity.
4. **Done.** Links to the sync and survey activities setup created, then **Go to Programs**.

Progress is kept in `studio.onboarding`. **Skip for now** (or ←) leaves it resumable from a dismissible **Finish
setup** row in the sidebar; **Re-run setup** is on Integrations. No step asks for a review or confirmation before
the next one.

## Activities

Every action the dean takes is an activity: a row in `studio.activities` and a thread in the sidebar, with a finish.

| Kind | URL | Shape | Created by | Finishes |
| --- | --- | --- | --- | --- |
| Program review | `/a/:id/review/explore` … `/packet` | Explore → Diagnose → Build changes → Board packet (progress bar) | A program row, **Start a review**, or "Open in Program review" (`POST /activities/new kind=review`); resumes the program's open review if there is one | Closed by hand (Completed after a packet export, else Closed early), or auto-closed by a sync |
| Outcomes story | `/a/:id/outcomes/story` … `/export` | Story (the report itself) → Dig deeper → Fix → Export (progress bar) | **Outcomes story** (`kind=outcomes`); resumes the open one | Same as a review |
| Survey | `/a/:id/survey` | Single page: sent to N, response progress (demo), who it fills gaps for, Remind, Close | Sending a survey: Surveys page, setup step 3, "Survey them" inside a review (stays on the page and shows a toast), or `POST /activities/new kind=survey audience=…`. Drafts aren't activities | When the survey is closed (by hand, here or on Surveys; the two stay in step). The simulated response window never closes it on its own |
| Data sync | `/a/:id/sync` | Single page: what changed, activities it auto-closed or flagged, corrections applied, data health | Every sync run: setup step 2, Integrations **Sync now** (`POST /api/sync`), `npm run db:sync` | On its own: Completed (`close_reason = 'finished'`) or Failed with the error |

Reviews and stories never contain connect, sync or survey-sending steps: connecting happens in setup, and syncs and
surveys are their own activities.

**Threads.** One list, newest activity first. Each thread shows a kind glyph (magnifier, bars, speech bubble,
circular arrows), the title (program plus kind; syncs use the source and a summary such as "2 programs changed"),
the kind name, a status label and the time since it last moved. Closed threads sit in a collapsible **Closed** group
(newest 20, then **Show all**). The ⋯ menu offers Open, Close activity… / Close survey…, Reopen (reviews and stories
only) and Mark data reviewed. Threads move to the top as you work, with layout animation.

**Fullscreen.** `/a/*` hides the sidebar. Multi-step kinds get the stage bar (header plus stage progress);
single-page kinds get the same header without stages: ← exit, kind glyph, title, status label, Close and the
primary action. A closed review or story shows a read-only banner and **Reopen**.

**Lifecycle** (`status`): `open` when created → `running` once a stage past the first is visited or any state is
saved (surveys and syncs start `running`) → `closed`. Reopening a review or story sets it back to `running`.

**Status label** (derived in one place, `activityStatus()` in `activities.server.ts`):

| Label | When |
| --- | --- |
| Collecting data | Review/story flagged `needs_review` by a sync, or its program has a survey sent and still open; a survey that is open |
| In progress | A review or story otherwise; a sync while it runs |
| Exported | A review or story produced an artifact and isn't closed: board packet saved as PDF, story saved as PDF, or its CSV downloaded (each records an `exported` event and sets `exported_at`) |
| Completed | Review/story closed by a sync, or by hand after an export; a closed survey; a finished sync |
| Closed early | Review/story closed by hand with nothing exported |
| Failed | A sync that errored (the error is the close note) |

**Saved state.** `state` jsonb holds the review's change selections (`changes`) and the outcomes Fix choices (`fix`).
Pages save through a fetcher (`POST /activities/:id intent=state`); the activity loader renders saved values on the
server, so there is no flash and no client-only state.

## Sync and auto-close

Setup's sync step, **Sync now** (Integrations page, `POST /api/sync`) and `npm run db:sync` run the same pipeline
(`scripts/lib/pipeline.mjs`): open a sync activity, re-import `raw` + `app`, reconcile every review and story that
isn't closed, record a row in `studio.syncs` (linked both ways to the activity), then finish the activity.

When a review or story opens, it stores a **fingerprint** of its program's data (md5 over the program's alumni rows plus
its curriculum: courses, course skills, program skills) and its open **data issues** (`studio.program_issues`):

- `no_job`: alumni with no job on record, while fewer than 90% are matched (the reporting threshold)
- `unmatched`: jobs not matched to an occupation
- `no_wage`: jobs with no wage on record
- `wage_units`: wages reported hourly rather than annually

After a sync, for each non-closed review or story:

- data unchanged → nothing happens;
- data changed **and** no issues remain → auto-closed with `close_reason = 'sync'` and a note such as
  "Closed by sync on Nov 5, 2026: data updated and corrected";
- data changed but issues remain → `needs_review` is set ("Data updated — review again" on the thread and in the
  activity), and the new fingerprint and issues become its baseline. **Mark as reviewed** clears the flag.

**The example data is static**, so a plain sync changes nothing and closes nothing. To demo the auto-close honestly,
`data/corrections/demo-outcome-survey.simulated.json` holds **simulated** corrections (pretend survey answers and
employer verification): jobs and wages for every Marketing, B.S. alumnus missing them, and jobs for 6 reachable
Business Administration, B.S. alumni. They apply to `raw.*` before the transform, only with
`--with-demo-corrections` or the "simulated" toggle beside Sync now; `db:import` never applies them. With them:
an open Marketing, B.S. activity auto-closes (every issue resolved); an open Business Administration, B.S. activity
is flagged (84% matched, still under 90%). A later plain import or sync reverts the data (and flags again). Real
correction files (`data/corrections/*.json` without `.simulated`) are applied on every import and sync.

## Routes

| Path | Screen |
| --- | --- |
| `/` | Dashboard (Programs). The first visit goes to `/onboarding` until setup has been started |
| `/onboarding/connect`, `/sync`, `/surveys`, `/done` | Workspace setup (fullscreen; `/onboarding` resumes the current step) |
| `POST /activities/new` | `{programId, kind: review\|outcomes\|survey, stage?, audience?, from?, stay?}`: resume or open a review or story, or send a survey and open its activity |
| `POST /activities/:id` | `intent` = visit, state, close, reopen, ack, export. `GET` redirects to the activity |
| `POST /api/sync` | `{demoCorrections?: "1", source?}` → `{sync}` (with `activity_id`) |
| `/a/:id` | Activity layout (loads the activity; fullscreen). Index redirects to the activity |
| `/a/:id/review/explore` | 1 · Explore: skill coverage against the target occupation's King County postings, a "Survey them" action, and an agent panel |
| `/a/:id/review/diagnose` | 2 · Diagnose: why the program is losing students |
| `/a/:id/review/build` | 3 · Build changes: pick changes and watch coverage move (selections saved on the activity) |
| `/a/:id/review/packet` | 4 · Board packet; "Export packet · PDF" records an export, then prints |
| `/a/:id/outcomes/story` | 1 · Story: the report, with the claims the data supports and the charts behind them |
| `/a/:id/outcomes/deeper` | 2 · Dig deeper: `?tab=pay`, `slow`, or `unknown` (optional reading) |
| `/a/:id/outcomes/fix` | 3 · Fix the story (choices saved on the activity) |
| `/a/:id/outcomes/export` | 4 · Export (saving as PDF records an export) |
| `/a/:id/outcomes/data.csv` | Every claim with its count, denominator, and source file, as CSV (records an export) |
| `/a/:id/survey` | A survey activity |
| `/a/:id/sync` | A sync activity |
| `/a/:id/review/{connect,sync,survey}` | Retired: redirect to the review's Explore stage |
| `/a/:id/outcomes/{scan,say}` | Retired: redirect to the story |
| `/review/*`, `/outcomes/*`, `/outcomes/data.csv` | Old bookmarks. GETs never create anything: they redirect into the default program's live activity if there is one, else to `/`; `/review/{connect,sync,survey}` go to setup until it's complete |

**Any program.** The target occupation is the program's highest King County 2024 alignment score (among
occupations with a skills benchmark); Business Administration, B.S. → Management Analysts. The change package is
built from the three biggest skill gaps: a gap some NSSU course teaches becomes "Add `<code> <name>` as an approved
elective" (REUSE · LOW; same degree level first, then the course most programs already share); a gap nothing
teaches becomes "Add a `<skill>` unit to `<the program's most relevant required course>`" (EDIT · MEDIUM; a data or
analytics course for software skills, else the program's home subject). Internships target the employers that
hire the most in-field grads. Small programs get empty states and "too few records" notes, and claims without data
behind them are left out.

## Workspace pages

Standalone dashboards in the sidebar's Workspace group. They render with the sidebar and are not activities.
State lives in the `studio` schema (`db/studio-workspace.sql`: `surveys`, `survey_events`, `integrations`,
`exports`, `settings`). `app/lib/workspace.server.ts` applies the file lazily, once per process, and so do
import and sync. Selected rows and panels live in the URL (`?s=`, `?new=1`, `?c=`, `?sync=`, `?x=`), so
they can be linked and survive a reload.

| Path | Page |
| --- | --- |
| `/surveys` | One survey per program × audience (Employers / Alumni). Draft → Scheduled → Sent → Closed. Send, schedule, remind non-responders, close, duplicate as a new wave. Empty state creates alumni drafts for every program with unknown outcomes. |
| `/integrations` | Lightcast local import (datasets and record counts from `raw.*`), **Sync now** (`POST /api/sync`, with an optional demo-corrections toggle), sync history, data-health checks, and other connectors. |
| `/exports` | Library of activity exports (`studio.activity_events` with `type = 'exported'`) and quick exports. **Quick export** downloads program CSVs without an activity. |
| `/exports/:programId/outcomes.csv`, `/exports/:programId/alignment.csv` | Quick-export CSVs: outcome claims with n and small-sample flags, or alignment and skill coverage for the default region |
| `/account` | Profile, institution counts (`#institution`), and preferences: the small-sample threshold (default 10) and the default target region, both read by the pages above |

The survey API used by setup, "Survey them" and survey activities (`listSurveys`, `createSurvey`, `sendSurvey`, `remindSurvey`,
`closeSurvey`, `surveyForProgram`, …) is documented at the top of `workspace.server.ts`.

**Simulated on these pages, and labelled "demo":** survey response counts (generated from the send time and
reminders; the demo clock runs 1 day per real minute; never added to a real metric), reminder non-responder
counts, demo corrections applied by a sync, and "connected" states for connectors other than Lightcast (no data
flows). Audience sizes, gaps such as "fills up to N unknown jobs", dataset counts, health checks and every CSV value
come from the database.

## What's real vs. simulated

**Computed from the example data** (Postgres queries over `./data`): program and course catalogs, skill
coverage and the "two courses get you to 93%" what-if, posting counts and wages, alignment scores, alumni
counts, in-field rates, pay, time-to-job, retention in the region, data-coverage figures, survey *audience*
sizes, and every number in the outcomes story and CSV. Keep in mind that the example data is itself synthetic:
the institutions, people, wages, and postings are fictional. Occupation, skill, CIP, and county references are
real public data. See `data/README.md`.

**Simulated for the prototype:**

- **Integrations UI.** Banner, CourseLeaf, Raiser's Edge, Handshake and the rest are illustrative. The records
  come from the example dataset, not from a live connection.
- **Survey response counts and employer quotes.** The numbers of people who answered, and what they said,
  are invented. Screens label them "demo".
- **Enrollment sparklines on home.** The dataset has no enrollment records, so the trend lines are drawn by
  hand. The table footnotes them.
- **AI agent replies.** The ask bar and the explore and packet assistants return canned answers. No model
  is called.
- **Demo corrections.** `data/corrections/*.simulated.json` is made-up data used only to demo sync auto-close.
  It is opt-in and labelled "simulated" wherever it can be applied.

## Implementation notes

- **SSR-safe motion.** `<MotionRoot>` (in `app/components/flow.tsx`, mounted in `root.tsx`) blocks Motion's
  `initial` states during the server render and hydration. The HTML therefore ships with final opacity, bar
  widths, and counter values, and works without JS or in throttled tabs. Anything mounted after hydration
  (route changes, new panels) animates in as designed. `<MotionConfig reducedMotion="user">` and a CSS
  `prefers-reduced-motion` block respect the OS setting.
- **Route transitions.** `AnimatedOutlet` cross-fades between the dashboard and the two activities, and
  between the steps inside each activity. The outgoing route keeps its location and loader data while it
  exits.
