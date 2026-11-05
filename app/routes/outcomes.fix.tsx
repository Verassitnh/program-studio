import { motion, useReducedMotion } from "motion/react";
import { type ReactNode } from "react";
import { Form } from "react-router";
import { FIX_DEFAULT, useActivityState, type FixState } from "~/components/activities";
import { Eyebrow, Item, Stagger, cx, ease } from "~/components/ui";
import { roleWord } from "~/lib/activity";
import { programOf } from "~/lib/activities.server";
import { storyClaims } from "~/lib/data.server";
import type { Route } from "./+types/outcomes.fix";

export const loader = async ({ params }: Route.LoaderArgs) => storyClaims(await programOf(params));

const usd = (v: number | null | undefined) => (v == null ? "—" : `$${(Math.round(v / 100) / 10).toFixed(1)}k`);
const k = (v: number | null) => (v == null ? "—" : `$${Math.round(v / 1000)}k`);
const pctOf = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
/** "Columbia Supply Cooperative" → "Columbia Supply" */
const shortName = (s: string) => s.split(" ").slice(0, 2).join(" ");

function FixCard({ label, tone = "ink", status, children }: { label: string; tone?: "ink" | "line" | "red"; status: ReactNode; children: ReactNode }) {
  return (
    <Item
      className={cx(
        "flex gap-4 rounded-[14px] border px-[18px] py-4 transition-colors duration-300",
        tone === "red" ? "border-red bg-red-soft" : tone === "ink" ? "border-ink" : "border-line",
      )}
    >
      <div className="flex w-[124px] shrink-0 flex-col gap-1.5">
        <div className={cx("label text-[10px] leading-3", tone === "red" ? "text-red-deep" : "text-subtle")}>{label}</div>
        {status}
      </div>
      <div className="flex grow flex-col gap-1.5">{children}</div>
    </Item>
  );
}

const pill = "w-fit whitespace-nowrap rounded-full px-2 py-[3px] text-[11px] leading-[14px]";
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/**
 * Renders every variant in one grid cell and shows only `active`, so the box is always as big as the
 * longest variant and toggling never shifts the layout below it. Hidden variants are aria-hidden.
 */
function Swap({ variants, active, className }: { variants: ReactNode[]; active: number; className?: string }) {
  return (
    <span className={cx("grid", className)}>
      {variants.map((v, i) => (
        <span
          key={i}
          aria-hidden={i !== active || undefined}
          className={cx("col-start-1 row-start-1 transition-[opacity,visibility] duration-150 ease-out", i === active ? "visible opacity-100" : "invisible opacity-0")}
        >
          {v}
        </span>
      ))}
    </span>
  );
}

function Reword({ on, onToggle, label, before, after, note, disabled }: { on: boolean; onToggle: () => void; label: string; before: string; after: string; note: string; disabled?: boolean }) {
  return (
    <FixCard
      label={label}
      tone={on ? "ink" : "line"}
      status={
        <motion.button
          type="button"
          whileTap={disabled ? undefined : { scale: 0.96 }}
          onClick={disabled ? undefined : onToggle}
          aria-pressed={on}
          aria-disabled={disabled || undefined}
          className={cx(pill, "border transition-colors duration-150", focusRing, on ? "border-ink bg-ink text-white" : "border-ink text-ink hover:bg-surface")}
        >
          {/* aria-pressed carries the state for screen readers; the label shows it visually. */}
          <Swap variants={["Apply reword", "Reword applied"]} active={on ? 1 : 0} />
        </motion.button>
      }
    >
      <p className={cx("relative w-fit text-[13px] leading-4", on ? "text-subtle/85" : "text-ink")}>
        {on && <span className="sr-only">Replaced: </span>}“{before}”
        <motion.span
          aria-hidden
          className="absolute left-0 right-0 top-1/2 h-px origin-left bg-subtle/85"
          initial={false}
          animate={{ scaleX: on ? 1 : 0 }}
          transition={{ duration: 0.3, ease }}
        />
      </p>
      {/* Always rendered so applying or undoing a reword never changes the card height. */}
      <p className={cx("text-pretty text-[15px] font-semibold leading-5 transition-colors duration-150", on ? "text-ink" : "text-subtle/85")}>
        {!on && <span className="sr-only">Suggested: </span>}“{after}”
      </p>
      <p className="text-xs leading-4 text-subtle">{note}</p>
    </FixCard>
  );
}

export default function Fix({ loaderData }: Route.ComponentProps) {
  const { say, deep, headline } = loaderData;
  // Saved on the activity: survives reloads and shows in the stage bar's "N fixes applied".
  const [fix, setFix, { readOnly }] = useActivityState<FixState>("fix", FIX_DEFAULT);
  const applied = fix;
  const sent = fix.sent;
  const reduce = useReducedMotion();
  const tween = (delay: number) => (reduce ? { duration: 0 } : { duration: 0.9, ease, delay });
  const early = deep.byStage[0];
  const mid = deep.byStage[1];
  const known = pctOf(deep.stats.in_field, deep.stats.alumni);
  const ceiling = pctOf(deep.stats.in_field + deep.unknown.n, deep.stats.alumni);
  const within6 = pctOf(say.ttj.within6, say.ttj.n);
  const fast = say.within3 === 50 ? "Half were" : `${say.within3}% were`;
  const [e1, e2] = deep.targetEmployers;
  const word = roleWord(deep.occupation.name);
  const Word = word.charAt(0).toUpperCase() + word.slice(1);
  // The pay-by-stage reword needs grads at both early stages; slow-hire wording needs job dates.
  const canPay = early.n > 0 && mid.n > 0;
  const canSlow = say.ttj.n > 0;
  const repeat = say.employers.filter((e) => e.n >= 7).length > 0;

  // Each bullet lists its variants; the reworded one is index 1. Bullets without data behind them are left out.
  const bullets: { variants: string[]; active: number }[] = [
    ...(say.topOcc ? [{ variants: [`${say.topOcc.n} grads work as ${say.topOcc.name.toLowerCase()}.`], active: 0 }] : []),
    ...(canSlow ? [{ variants: [`${within6}% were hired within 6 months.`, `${fast} hired within 3 months.`], active: applied.slow ? 1 : 0 }] : []),
    ...(deep.wageMedian != null
      ? [{ variants: [`Grads earn a median ${usd(deep.wageMedian)}.`, canPay ? `${Word}s earn a median ${k(early.median)} early on and ${k(mid.median)} by years 4–7.` : `Grads earn a median ${usd(deep.wageMedian)}.`], active: applied.pay ? 1 : 0 }]
      : []),
    ...(repeat ? [{ variants: ["The same employers hire our grads again and again."], active: 0 }] : []),
  ];
  const recent = say.cohorts.find((c) => c.cohort === "2020–25")!;
  const groupsUsed = [recent.known, say.stats.matched, say.ttj.n, ...(applied.pay && canPay ? [early.n, mid.n] : [deep.stats.matched])].filter((n) => n > 0);
  const claimCount = bullets.length + 1;

  return (
    <div className="flex grow gap-9 px-12 py-[26px]">
      <Stagger className="flex grow flex-col gap-3">
        <Item className="flex flex-col gap-1.5 pb-1">
          <Eyebrow>Stage 3 · Fix the story</Eyebrow>
          <h1 className="text-[28px] font-semibold leading-[34px] tracking-[-0.03em] text-ink">
            {canPay && canSlow ? "Two fixes are wording. Two need work." : "Some fixes are wording. Some need data."}
          </h1>
        </Item>
        <Reword
          on={applied.pay}
          onToggle={() => setFix((a) => ({ ...a, pay: !a.pay }))}
          label="Pay"
          before={`Our grads earn a median ${usd(deep.wageMedian)}.`}
          after={
            canPay
              ? `Our ${word}s earn a median ${k(early.median)} in their first 3 years and ${k(mid.median)} by years 4–7.`
              : `Our grads with a known annual wage earn a median ${usd(deep.wageMedian)} (${deep.stats.wage_n} grads).`
          }
          note={canPay ? `${early.n} and ${mid.n} grads · different grads at each stage · alumni-record.json` : `Too few ${word}s with pay at each career stage to split by stage · alumni-record.json`}
          disabled={readOnly}
        />
        <Reword
          on={applied.slow}
          onToggle={() => setFix((a) => ({ ...a, slow: !a.slow }))}
          label="Slow hires"
          before={canSlow ? `${within6}% hired within 6 months.` : "Most grads are hired fast."}
          after={
            canSlow
              ? `${fast} hired within 3 months.${deep.slow.n ? ` Of the ${deep.slow.n} who took over a year, ${deep.slow.now_in_field} now work in their field.` : ""}`
              : "We don’t have first-job dates yet."
          }
          note={
            canSlow
              ? `${say.ttj.n} grads with job dates${deep.slow.n ? ` · ${deep.slow.now_target} of those ${deep.slow.now_in_field} are ${word}s · ${deep.slow.from2020} of the ${deep.slow.n} graduated 2020–22` : ""}`
              : "No career-history dates on record"
          }
          disabled={readOnly}
        />
        <FixCard label="Unknowns" tone="red" status={<div className={cx(pill, "bg-red-deep text-white")}>Get data</div>}>
          <div className="flex flex-col gap-2">
            <div className="text-[15px] font-semibold leading-5 text-ink">
              {deep.unknown.n} grads have no job on record. {deep.unknown.reachable} are reachable.
            </div>
            <div className="flex flex-col gap-1">
              <div aria-hidden className="flex h-2.5 overflow-hidden rounded-full bg-white">
                <motion.div className="bg-ink" initial={{ width: 0 }} animate={{ width: `${known}%` }} transition={tween(0.3)} />
                <motion.div className="hatch-red" initial={{ width: 0 }} animate={{ width: `${ceiling - known}%` }} transition={tween(0.5)} />
              </div>
              <div className="flex justify-between text-[11px] leading-[14px] text-subtle tabular-nums">
                <div>
                  Known in field today: {known}% of all {deep.stats.alumni}
                </div>
                <div>
                  Could reach {ceiling}% if all {deep.unknown.n} are in field
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <motion.button
                type="button"
                whileHover={sent ? undefined : { y: -1 }}
                whileTap={sent ? undefined : { scale: 0.96 }}
                onClick={() => (sent || readOnly ? undefined : setFix((a) => ({ ...a, sent: true })))}
                aria-disabled={sent || readOnly || undefined}
                className={cx("h-[30px] rounded-full px-3.5 text-xs transition-colors duration-150", focusRing, sent ? "cursor-default bg-white text-ink" : "bg-ink text-white hover:bg-[#1c1c1c]")}
              >
                <Swap variants={[`Send outcome survey to ${deep.unknown.reachable}`, `✓ Survey sent to ${deep.unknown.reachable}`]} active={sent ? 1 : 0} />
              </motion.button>
              <div className="text-xs leading-4 text-subtle">
                {deep.unknown.email} email · {deep.unknown.linkedin_only} LinkedIn only
              </div>
              {/* Rendered empty first so the confirmation is announced. */}
              <div role="status" className="sr-only">
                {sent ? `Outcome survey sent to ${deep.unknown.reachable} reachable grads.` : ""}
              </div>
            </div>
          </div>
        </FixCard>
        <FixCard label="Out of field" tone="line" status={<div className={cx(pill, "border border-ink text-ink")}>Change outcomes</div>}>
          <div className="text-[15px] font-semibold leading-5 text-ink">
            {deep.outField.n} grads work outside the field, earning a median {usd(deep.outField.median)}.
          </div>
          <div className="text-xs leading-[17px] text-subtle">
            Not a wording fix.{" "}
            {e1 && e2
              ? `${shortName(e1.employer)} (${e1.target} ${word}s) and ${shortName(e2.employer)} (${e2.target}) already employ your grads as ${word}s. Start with internships there.`
              : e1
                ? `${shortName(e1.employer)} (${e1.target} ${word}s) already employs your grads as ${word}s. Start with internships there.`
                : "Start with internships at employers who hire in the field."}
          </div>
          {/* Opens (or resumes) this program's Program review at its change package. */}
          <Form method="post" action="/activities/new">
            <input type="hidden" name="programId" value={say.program.id} />
            <input type="hidden" name="kind" value="review" />
            <input type="hidden" name="stage" value="build" />
            <button type="submit" className={cx("w-fit rounded-sm text-xs font-medium leading-4 text-ink underline underline-offset-4 transition-colors duration-150 hover:text-red-deep", focusRing)}>
              Open in Program review → change package
            </button>
          </Form>
        </FixCard>
      </Stagger>
      <Stagger className="flex w-[360px] shrink-0 flex-col gap-3" delay={0.15}>
        <Item>
          <Eyebrow tone="muted">The story you can tell today</Eyebrow>
        </Item>
        <Item className="flex flex-col gap-4 rounded-[18px] bg-ink p-6">
          <div className="label text-[10px] leading-3 tracking-[0.08em] text-muted">NSSU · {say.program.name}</div>
          <div className="text-[22px] font-semibold leading-[27px] tracking-[-0.02em] text-white">{headline}</div>
          <ul className="flex flex-col gap-2.5 text-[13px] leading-[19px] text-line">
            {bullets.map((b, i) => (
              <li key={i} className="flex gap-1">
                <span aria-hidden>·</span>
                <Swap variants={b.variants} active={b.active} />
              </li>
            ))}
          </ul>
          <div className="h-px bg-[#3a3a3a]" />
          <Swap
            className="text-[11px] leading-4 text-muted"
            active={applied.pay ? 1 : 0}
            variants={[0, 1].map((v) => (
              <>
                NSSU alumni records, 2011–2025, with a known job ({deep.stats.matched} of {deep.stats.alumni}). Recent = 2020–25 (n = {recent.known}).
                {v === 1 && " Pay groups are different grads at different career stages."}
              </>
            ))}
          />
        </Item>
        <Item className="flex flex-col gap-2 rounded-xl bg-surface px-4 py-3.5 text-[13px] leading-4 tabular-nums">
          {[
            ["Claims backed by data", `${claimCount} of ${claimCount}`, false],
            ["Smallest group used", groupsUsed.length ? `${Math.min(...groupsUsed)} grads` : "none yet", false],
            ["Waiting on data", sent ? "survey out" : `${deep.unknown.n} unknowns`, true],
          ].map(([a, b, red]) => (
            <div key={String(a)} className="flex justify-between">
              <div className="text-subtle">{a}</div>
              <motion.div key={String(b)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} className={cx("font-mono", red ? "text-red-deep" : "text-ink")}>
                {b}
              </motion.div>
            </div>
          ))}
        </Item>
      </Stagger>
    </div>
  );
}
