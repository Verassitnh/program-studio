// Workspace setup (/onboarding): connect sources → initial sync and data check → fill gaps with surveys → done.
// Runs once per workspace (re-runnable from Integrations). Progress lives in studio.onboarding (db/studio.sql).
import { ensureStudio } from "./activities.server";
import { one, q } from "./db.server";
import { createSurvey, sendSurvey, surveyForProgram } from "./workspace.server";

export const STEPS = ["connect", "sync", "surveys", "done"] as const;
export type Step = (typeof STEPS)[number];
export const isStep = (s: unknown): s is Step => STEPS.includes(s as Step);

export type OnboardingStatus = "not_started" | "in_progress" | "skipped" | "completed";
export type Onboarding = {
  status: OnboardingStatus;
  step: Step;
  data: { syncId?: number; surveys?: { programId: string; name: string; audience: string; ok: boolean; message: string }[] };
  bannerDismissed: boolean;
  completedAt: string | null;
};

type Row = { status: OnboardingStatus; step: string; data: Onboarding["data"]; banner_dismissed: boolean; completed_at: Date | null };

export async function getOnboarding(): Promise<Onboarding> {
  await ensureStudio();
  let row = await one<Row | undefined>(`select status, step, data, banner_dismissed, completed_at from studio.onboarding where id = 1`);
  if (!row) {
    await q(`insert into studio.onboarding (id) values (1) on conflict (id) do nothing`);
    row = { status: "not_started", step: "connect", data: {}, banner_dismissed: false, completed_at: null };
  }
  return {
    status: row.status,
    step: isStep(row.step) ? row.step : "connect",
    data: row.data ?? {},
    bannerDismissed: row.banner_dismissed,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
  };
}

/** A step visit: records progress. Reaching "done" completes setup. A completed setup stays completed on re-runs. */
export async function visitStep(step: Step) {
  await ensureStudio();
  await q(
    `update studio.onboarding set step = $1, updated_at = now(),
            started_at = coalesce(started_at, now()),
            status = case when $1 = 'done' then 'completed' when status = 'completed' then 'completed' else 'in_progress' end,
            completed_at = case when $1 = 'done' then coalesce(completed_at, now()) else completed_at end
     where id = 1`,
    [step],
  );
}

export async function skipOnboarding() {
  await ensureStudio();
  await q(`update studio.onboarding set status = case when status = 'completed' then status else 'skipped' end, skipped_at = now(), updated_at = now() where id = 1`);
}

export async function dismissBanner() {
  await ensureStudio();
  await q(`update studio.onboarding set banner_dismissed = true, updated_at = now() where id = 1`);
}

export async function mergeData(patch: Onboarding["data"]) {
  await ensureStudio();
  await q(`update studio.onboarding set data = data || $1::jsonb, updated_at = now() where id = 1`, [JSON.stringify(patch)]);
}

/* ------------------------------------------------------------ data for the steps */

/** School of Business programs ranked by alumni with no job on record (the survey step's default picks). */
export async function gapPrograms() {
  return q<{ id: string; name: string; alumni: number; unknown: number; reachable: number; employers: number }>(
    `select p.id, p.name, count(a.id)::int as alumni,
            count(a.id) filter (where not coalesce(a.has_employment, false))::int as unknown,
            count(a.id) filter (where not coalesce(a.has_employment, false) and a.has_email)::int as reachable,
            count(distinct a.employer)::int as employers
     from app.programs p left join app.alumni a on a.program_id = p.id
     where p.institution_id = 'north-sound-state' and p.cip_code like '52.%'
     group by p.id, p.name having count(a.id) filter (where not coalesce(a.has_employment, false)) > 0
     order by unknown desc, p.name`,
  );
}

/**
 * Creates (or reuses the open draft of) each program × audience survey and sends it, through the workspace
 * survey API. Already-sent surveys are left alone. Responses that follow are simulated (labelled demo).
 */
export async function sendGapSurveys(picks: { programId: string; audience: "alumni" | "employers" }[]) {
  const names = new Map((await gapPrograms()).map((p) => [p.id, p.name]));
  const results: NonNullable<Onboarding["data"]["surveys"]> = [];
  for (const { programId, audience } of picks) {
    const name = names.get(programId) ?? programId;
    const current = (await surveyForProgram(programId))[audience];
    if (current && (current.status === "sent" || current.status === "scheduled")) {
      results.push({ programId, name, audience, ok: true, message: `Already ${current.status}` });
      continue;
    }
    let id = current && current.status === "draft" ? current.id : null;
    if (!id) {
      const created = await createSurvey({ programId, audience });
      if (!created.ok) {
        results.push({ programId, name, audience, ok: false, message: created.error });
        continue;
      }
      id = created.id;
    }
    const sent = await sendSurvey(id);
    results.push({ programId, name, audience, ok: sent.ok, message: sent.ok ? sent.message : sent.error });
  }
  await mergeData({ surveys: results });
  return results;
}
