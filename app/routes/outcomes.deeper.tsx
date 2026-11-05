import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { useSearchParams, type ShouldRevalidateFunctionArgs } from "react-router";
import { HBar, VBar, cx, ease } from "~/components/ui";
import { roleWord } from "~/lib/activity";
import { programOf } from "~/lib/activities.server";
import { deeperData } from "~/lib/data.server";
import type { Route } from "./+types/outcomes.deeper";

export const loader = async ({ params }: Route.LoaderArgs) => deeperData(await programOf(params));

// Switching tabs only changes ?tab=, the data stays the same.
export const shouldRevalidate = ({ currentUrl, nextUrl, formMethod, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) =>
  !formMethod && currentUrl.pathname === nextUrl.pathname ? false : defaultShouldRevalidate;

type D = Route.ComponentProps["loaderData"];

/** Groups smaller than this get flagged. */
const SMALL_N = 10;
const usd = (v: number | null | undefined) => (v == null ? "—" : `$${(Math.round(v / 100) / 10).toFixed(1)}k`);
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
/** Bar length as a share of `of`, 0 when there's nothing to compare. */
const share = (v: number | null | undefined, of: number) => (v && of ? (100 * v) / of : 0);

/* ---------------------------------------------------------------- shared */

function Headline({ children }: { children: ReactNode }) {
  return <h2 className="max-w-[820px] text-[28px] font-semibold leading-[34px] tracking-[-0.03em] text-ink">{children}</h2>;
}

function ChartTitle({ children }: { children: ReactNode }) {
  return <div className="text-sm font-semibold leading-[18px] text-ink">{children}</div>;
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-pretty text-xs leading-[17px] text-subtle/85">{children}</p>;
}

/** Width/height tweens aren't covered by MotionConfig's reducedMotion (it only drops transforms), so gate them here. */
function useTween() {
  const reduce = useReducedMotion();
  return (t: { duration: number; delay?: number }) => (reduce ? { duration: 0 } : { ...t, ease });
}

/** Label + value over a 14px bar, as in the Pay tab's right column. */
function BarRow({ label, value, pct: p, color, valueTone = "ink", strong, small, delay = 0 }: { label: ReactNode; value: ReactNode; pct: number; color: string; valueTone?: "ink" | "red"; strong?: boolean; small?: boolean; delay?: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-[13px] leading-4">
        <div className="text-ink">
          {label}
          {small && <span className="text-subtle/85"> · small group</span>}
        </div>
        <div className={cx("font-mono tabular-nums", strong && "font-semibold", valueTone === "red" ? "text-red-deep" : "text-ink")}>{value}</div>
      </div>
      <div aria-hidden>
        <HBar pct={p} h={14} track="bg-surface" color={color} delay={delay} />
      </div>
    </div>
  );
}

function SoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease, delay: 0.7 }}
      className="flex flex-col gap-2 rounded-[14px] bg-surface p-4"
    >
      <div className="text-[13px] font-semibold leading-4 text-ink">{title}</div>
      <div className="text-[13px] leading-[19px] text-text">{children}</div>
    </motion.div>
  );
}

/** Shown instead of a chart when there are no records behind it. */
function Empty({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[160px] items-center justify-center rounded-[14px] border border-dashed border-muted px-6 text-center text-[13px] leading-[19px] text-subtle">{children}</div>;
}

/* ------------------------------------------------------------------- pay */

function PayTab({ d }: { d: D }) {
  const H = 260;
  const role = d.occupation.name.toLowerCase();
  const word = roleWord(d.occupation.name);
  // 2px per $1k (the design's scale), stretched only if some median would overflow the plot.
  const top = Math.max(120000, ...d.byStage.map((s) => s.median ?? 0), d.ref.median ?? 0);
  const scale = (v: number | null) => (v ? (H - 20) * (v / top) : 0);
  const smallStages = d.byStage.filter((s) => s.n > 0 && s.n < SMALL_N);
  const anyStage = d.byStage.some((s) => s.n > 0);
  const gap = d.inField.median != null && d.outField.median != null ? d.inField.median - d.outField.median : null;
  const summary = `Median pay for grads working as ${role}, by years since graduating: ${d.byStage
    .map((s) => (s.n ? `${s.stage}, ${usd(s.median)} (${s.n} grads${s.n < SMALL_N ? ", small group" : ""})` : `${s.stage}, no grads`))
    .join("; ")}. Typical ${word} pay is ${usd(d.ref.median)}.`;
  return (
    <>
      <Headline>Pay looks low because one median mixes early-career {word}s with grads outside the field.</Headline>
      <div className="flex grow gap-9">
        <div className="flex flex-[1.3] flex-col gap-2.5">
          <ChartTitle>Grads working as {role} · median pay by years since graduating</ChartTitle>
          {!anyStage ? (
            <Empty>No grads on record work as {role} with an annual wage yet, so there is no pay-by-stage story to tell.</Empty>
          ) : (
          <>
          <div role="img" aria-label={summary} className="relative mt-2.5 shrink-0 border-b border-ink" style={{ height: H }}>
            {d.ref.median != null && (
            <motion.div
              className="absolute left-0 right-0 origin-left border-t-[1.5px] border-dashed border-red"
              style={{ bottom: scale(d.ref.median) }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.9, ease, delay: 0.6 }}
            />
            )}
            {d.ref.median != null && (
            <motion.div
              className="absolute left-5 text-[11px] font-medium leading-[14px] text-red-deep"
              style={{ bottom: scale(d.ref.median) + 7 }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.1 }}
            >
              Typical {word} pay · {usd(d.ref.median)}
            </motion.div>
            )}
            <div className="absolute inset-0 flex items-end gap-7 px-5">
              {d.byStage.map((s, i) => (
                <div key={s.stage} className="flex flex-1 flex-col items-center gap-1.5">
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease, delay: 0.75 + i * 0.1 }}
                    className={cx("text-[15px] font-semibold leading-[18px] tabular-nums", i === d.byStage.length - 1 ? "text-red-deep" : "text-ink")}
                  >
                    {s.n ? usd(s.median) : "—"}
                  </motion.div>
                  <VBar height={Math.max(2, scale(s.median))} color={i === 0 ? "bg-subtle" : i === d.byStage.length - 1 ? "bg-red" : "bg-ink"} delay={0.2 + i * 0.1} />
                </div>
              ))}
            </div>
          </div>
          <div aria-hidden className="flex gap-7 px-5 text-xs leading-4 text-subtle tabular-nums">
            {d.byStage.map((s) => (
              <div key={s.stage} className="flex-1 text-center">
                {s.stage} · {s.n} grads
              </div>
            ))}
          </div>
          <Note>
            Different grads at different career stages, not the same people over time.
            {smallStages.map((s) => ` ${s.stage.replace(" years", " year")} group is small (${s.n}).`)} Typical {word} pay = occupation median wage in alumni-record.json.
          </Note>
          </>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-[22px]">
          <div className="flex flex-col gap-2.5">
            <ChartTitle>{gap == null ? "In field vs. outside the field" : gap >= 0 ? `In-field grads earn ${usd(gap)} more` : `In-field grads earn ${usd(-gap)} less`}</ChartTitle>
            <BarRow label={`Working in field · ${d.inField.n} grads`} value={usd(d.inField.median)} pct={share(d.inField.median, 80000)} color="bg-ink" strong small={d.inField.n < SMALL_N} delay={0.3} />
            <BarRow label={`Outside the field · ${d.outField.n} grads`} value={usd(d.outField.median)} pct={share(d.outField.median, 80000)} color="bg-red" valueTone="red" strong small={d.outField.n < SMALL_N} delay={0.4} />
          </div>
          <div className="flex flex-col gap-2.5">
            <ChartTitle>In-field grads who stay local earn more</ChartTitle>
            <BarRow label={`In NSSU region · ${d.local.n}`} value={usd(d.local.median)} pct={share(d.local.median, 80000)} color="bg-ink" small={d.local.n < SMALL_N} delay={0.5} />
            <BarRow label={`Elsewhere · ${d.away.n}`} value={usd(d.away.median)} pct={share(d.away.median, 80000)} color="bg-muted" small={d.away.n < SMALL_N} delay={0.6} />
          </div>
          <Note>Medians of annual estimated wage. These are differences between groups, not the effect of a job or a move.</Note>
          <div className="grow" />
          <SoCard title="So the fix is two-part">
            1. Tell pay by career stage instead of one median.
            <br />
            2. Look at the {d.outField.n} out-of-field grads separately. Their {usd(d.outField.median)} median pulls the overall number down.
          </SoCard>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------- slow hires */

/** Job today, for the slow-hire list. `target` is the program's target occupation. */
const statusFor = (occupation: string) => ({
  target: { label: occupation.charAt(0) + occupation.slice(1).toLowerCase().replace(/s$/, ""), bar: "bg-ink" },
  in_field: { label: "Other in-field job", bar: "bg-subtle" },
  out: { label: "Outside the field", bar: "bg-red" },
  unknown: { label: "No job on record", bar: "bg-muted" },
});

const classOf = (y: number) => (y <= 2015 ? "2011–15" : y <= 2019 ? "2016–19" : "2020–25");

function SlowTab({ d }: { d: D }) {
  const STATUS = statusFor(d.occupation.name);
  const word = roleWord(d.occupation.name);
  if (!d.slow.n) {
    return (
      <>
        <Headline>{d.ttjN ? `No grads took more than 12 months to a first job.` : "No first-job dates on record yet."}</Headline>
        <Empty>
          {d.ttjN ? `All ${d.ttjN} grads with job dates were hired within a year, so there are no slow hires to explain.` : "Time to first job needs career-history dates. Survey alumni or connect a career-services source."}
        </Empty>
      </>
    );
  }
  const max = Math.ceil(Math.max(...d.slowHires.map((s) => s.months), 12) / 12) * 12;
  const x = (m: number) => `${(100 * m) / max}%`;
  const byStatus = (["target", "in_field", "out", "unknown"] as const).map((k) => ({ k, n: d.slowHires.filter((s) => s.status === k).length })).filter((s) => s.n);
  const byClass = ["2011–15", "2016–19", "2020–25"].map((c) => ({ c, n: d.slowHires.filter((s) => classOf(s.graduation_year) === c).length })).filter((c) => c.n);
  const longest = d.slowHires.filter((s) => s.months >= 60);
  const tween = useTween();
  const fast = d.within3 === 50 ? "Half were" : `${d.within3}% were`;
  return (
    <>
      <Headline>
        Slow hires mostly got there: {d.slow.now_in_field} of {d.slow.n} now work in their field.
      </Headline>
      <div className="flex grow gap-9">
        <div className="flex flex-[1.3] flex-col gap-2.5">
          <ChartTitle>The {d.slow.n} grads who took 12+ months · months to a first job, colored by job today</ChartTitle>
          {/* A list, so each grad reads as one line: class, months and job today (the bar color alone isn't enough). */}
          <ul className="relative mt-2.5 flex flex-col gap-2">
            <motion.li
              aria-hidden
              className="absolute bottom-0 top-0 border-l-[1.5px] border-dashed border-red"
              style={{ left: `calc(76px + (100% - 132px) * ${12 / max})` }}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ duration: 0.7, ease, delay: 0.2 }}
            />
            {d.slowHires.map((s, i) => (
              <li key={i} className="flex h-[18px] items-center gap-0">
                <span className="w-[76px] shrink-0 text-xs leading-4 text-subtle">
                  Class of {s.graduation_year}
                  <span className="sr-only">: </span>
                </span>
                <span aria-hidden className="relative h-3.5 grow">
                  <motion.span
                    className={cx("block h-3.5 rounded-full", STATUS[s.status].bar)}
                    initial={{ width: 0 }}
                    animate={{ width: x(s.months) }}
                    transition={tween({ duration: 0.8, delay: 0.25 + i * 0.04 })}
                  />
                </span>
                <span className="w-14 shrink-0 text-right font-mono text-xs leading-4 text-ink tabular-nums">
                  {s.months} mo<span className="sr-only">, now: {STATUS[s.status].label.toLowerCase()}</span>
                </span>
              </li>
            ))}
          </ul>
          <div aria-hidden className="relative h-[14px] font-mono text-[11px] leading-[14px] text-subtle/85">
            <span className="absolute left-[76px]">0</span>
            <span className="absolute -translate-x-1/2 text-red-deep" style={{ left: `calc(76px + (100% - 132px) * ${12 / max})` }}>
              12 mo
            </span>
            <span className="absolute right-14 translate-x-1/2">{max}</span>
          </div>
          <div aria-hidden className="mt-1 flex flex-wrap gap-3.5 text-[11px] leading-[14px] text-subtle">
            {byStatus.map(({ k }) => (
              <div key={k} className="flex items-center gap-[5px]">
                <div className={cx("h-2 w-2 rounded-[2px]", STATUS[k].bar)} />
                {STATUS[k].label}
              </div>
            ))}
          </div>
          <Note>
            Months from June of the graduation year to the first job start after graduating ({d.slow.n} of {d.ttjN} grads with dates).
            {longest.length > 0 && ` ${longest.length} grads took 5+ years; their records may be missing earlier jobs, so treat them as outliers.`}
          </Note>
        </div>
        <div className="flex flex-1 flex-col gap-[22px]">
          <div className="flex flex-col gap-2.5">
            <ChartTitle>Where they work now</ChartTitle>
            {byStatus.map(({ k, n }, i) => (
              <BarRow
                key={k}
                label={STATUS[k].label}
                value={n}
                pct={(100 * n) / d.slow.n}
                color={STATUS[k].bar}
                valueTone={k === "out" ? "red" : "ink"}
                strong={k === "target"}
                delay={0.3 + i * 0.08}
              />
            ))}
          </div>
          <div className="flex flex-col gap-2.5">
            <ChartTitle>When they graduated</ChartTitle>
            {byClass.map(({ c, n }, i) => (
              <BarRow key={c} label={`Class of ${c}`} value={n} pct={(100 * n) / d.slow.n} color={c === "2020–25" ? "bg-ink" : "bg-muted"} delay={0.5 + i * 0.08} />
            ))}
          </div>
          <div className="grow" />
          <SoCard title="So say both halves">
            1. {fast} hired within 3 months.
            <br />
            2. Of the {d.slow.n} who took over a year, {d.slow.now_in_field} now work in their field ({d.slow.now_target} as {word}s). Don’t claim “most grads are hired fast.”
          </SoCard>
        </div>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- unknown */

function UnknownTab({ d }: { d: D }) {
  if (!d.unknown.n) {
    return (
      <>
        <Headline>Every alumnus has a job on record.</Headline>
        <Empty>{d.stats.alumni ? `All ${d.stats.alumni} alumni have a known job, so “most grads” claims rest on the whole class.` : "No alumni records for this program yet."}</Empty>
      </>
    );
  }
  const { alumni, in_field, matched } = d.stats;
  const out = matched - in_field;
  const floor = pct(in_field, alumni);
  const ceiling = pct(in_field + d.unknown.n, alumni);
  const cells = [...Array(in_field).fill("in"), ...Array(out).fill("out"), ...Array(d.unknown.n).fill("unknown")] as ("in" | "out" | "unknown")[];
  const both = d.unknown.linkedin - d.unknown.linkedin_only;
  const tween = useTween();
  return (
    <>
      <Headline>
        {d.unknown.n} grads have no job on record. {d.unknown.reachable} can be reached today.
      </Headline>
      <div className="flex grow gap-9">
        <div className="flex flex-[1.3] flex-col gap-2.5">
          <ChartTitle>All {alumni} alumni · what we know about their job today</ChartTitle>
          <div
            role="img"
            aria-label={`All ${alumni} alumni: ${in_field} in field, ${out} outside the field, ${d.unknown.n} with no job on record.`}
            className="mt-2.5 grid grid-cols-[repeat(21,minmax(0,1fr))] gap-1"
          >
            {cells.map((c, i) => (
              <motion.div
                key={i}
                className={cx("aspect-square rounded-[5px]", c === "in" ? "bg-ink" : c === "out" ? "bg-red" : "hatch-red")}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.35, ease, delay: 0.15 + i * 0.012 }}
              />
            ))}
          </div>
          <div aria-hidden className="flex flex-wrap gap-3.5 text-[11px] leading-[14px] text-subtle tabular-nums">
            <div className="flex items-center gap-[5px]"><div className="h-2 w-2 rounded-[2px] bg-ink" />In field · {in_field}</div>
            <div className="flex items-center gap-[5px]"><div className="h-2 w-2 rounded-[2px] bg-red" />Outside the field · {out}</div>
            <div className="flex items-center gap-[5px]"><div className="hatch-red h-2 w-2 rounded-[2px]" />No job on record · {d.unknown.n}</div>
          </div>
          <div className="mt-5 flex flex-col gap-2">
            <ChartTitle>Share of all alumni in field: somewhere between {floor}% and {ceiling}%</ChartTitle>
            <div aria-hidden className="mt-1 flex h-3.5 overflow-hidden rounded-full bg-surface">
              <motion.div className="bg-ink" initial={{ width: 0 }} animate={{ width: `${floor}%` }} transition={tween({ duration: 0.9, delay: 0.5 })} />
              <motion.div className="hatch-red" initial={{ width: 0 }} animate={{ width: `${ceiling - floor}%` }} transition={tween({ duration: 0.9, delay: 0.7 })} />
            </div>
            <div className="flex justify-between text-xs leading-4 text-subtle">
              <div>Known in field today: {floor}% of all {alumni}</div>
              <div>Could reach {ceiling}% if all {d.unknown.n} are in field</div>
            </div>
          </div>
          <Note>
            Among the {matched} with a known job, {pct(in_field, matched)}% work in field. That rate only holds for everyone if the {d.unknown.n} unknowns look like the rest, which
            we can’t check yet.
          </Note>
        </div>
        <div className="flex flex-1 flex-col gap-[22px]">
          <div className="flex flex-col gap-2.5">
            <ChartTitle>Who we can reach</ChartTitle>
            <BarRow label="Email on file" value={d.unknown.email} pct={(100 * d.unknown.email) / d.unknown.n} color="bg-ink" strong delay={0.3} />
            <BarRow label="LinkedIn only" value={d.unknown.linkedin_only} pct={(100 * d.unknown.linkedin_only) / d.unknown.n} color="bg-subtle" delay={0.38} />
            <BarRow label="No email or LinkedIn" value={d.unknown.no_contact} pct={(100 * d.unknown.no_contact) / d.unknown.n} color="bg-red" valueTone="red" delay={0.46} />
            {both > 0 && <Note>{both} of the {d.unknown.email} with email also have LinkedIn. Each person is counted once.</Note>}
          </div>
          <div className="flex flex-col gap-2.5">
            <ChartTitle>When they graduated</ChartTitle>
            {d.unknownByClass.map((c, i) => (
              <BarRow
                key={c.cohort}
                label={c.cohort === "Did not complete" ? "Did not complete" : `Class of ${c.cohort}`}
                value={c.n}
                pct={(100 * c.n) / d.unknown.n}
                color={c.cohort === "2020–25" ? "bg-ink" : "bg-muted"}
                delay={0.55 + i * 0.08}
              />
            ))}
          </div>
          <div className="grow" />
          <SoCard title="So the fix is data, not wording">
            1. Don’t say “most grads” while {d.unknown.n} of {alumni} are unknown.
            <br />
            2. Survey the {d.unknown.reachable} reachable grads. Each answer narrows the {floor}–{ceiling}% range.
          </SoCard>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ page */

const TABS = ["pay", "slow", "unknown"] as const;
type Tab = (typeof TABS)[number];

export default function Deeper({ loaderData: d }: Route.ComponentProps) {
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.find((t) => t === params.get("tab")) ?? "pay";
  const refs = useRef<Record<Tab, HTMLButtonElement | null>>({ pay: null, slow: null, unknown: null });
  const labels: Record<Tab, string> = {
    pay: `Pay · ${usd(d.wageMedian)} median`,
    slow: `Slow hires · ${d.slow.n} grads`,
    unknown: `Unknown outcomes · ${d.unknown.n} grads`,
  };
  const select = (k: Tab) => setParams({ tab: k }, { preventScrollReset: true, replace: true });

  // APG tabs, automatic activation: arrows move focus and select (panels render instantly), Home/End jump.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.indexOf(tab);
    const next =
      e.key === "ArrowRight" ? TABS[(i + 1) % TABS.length] : e.key === "ArrowLeft" ? TABS[(i - 1 + TABS.length) % TABS.length] : e.key === "Home" ? TABS[0] : e.key === "End" ? TABS[TABS.length - 1] : null;
    if (!next) return;
    e.preventDefault();
    select(next);
    refs.current[next]?.focus();
  };

  return (
    <div className="flex grow flex-col gap-5 px-12 py-6">
      <div role="tablist" aria-label="Weak spots" className="flex gap-2" onKeyDown={onKeyDown}>
        {TABS.map((k) => {
          const on = tab === k;
          return (
            <button
              key={k}
              ref={(el) => {
                refs.current[k] = el;
              }}
              id={`deeper-tab-${k}`}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls="deeper-panel"
              tabIndex={on ? 0 : -1}
              onClick={() => select(k)}
              className={cx(
                // Same 1px border in both states, so switching tabs never changes their width.
                "relative flex h-9 items-center rounded-full border px-3.5 text-[13px] leading-4 transition-colors duration-150",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
                on ? "border-transparent" : "border-line hover:border-ink",
              )}
            >
              {on && <motion.span layoutId="deeper-tab" className="absolute -inset-px rounded-full bg-ink" transition={{ type: "spring", duration: 0.3, bounce: 0 }} />}
              {/* The hidden medium-weight copy reserves the selected width, so the row doesn't reflow. */}
              <span className="relative grid">
                <span className={cx("col-start-1 row-start-1", on ? "font-medium text-white" : "text-ink")}>{labels[k]}</span>
                <span aria-hidden className="invisible col-start-1 row-start-1 font-medium">
                  {labels[k]}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {/* Tab switches are frequent: a short opacity fade, no movement. */}
        <motion.div
          key={tab}
          id="deeper-panel"
          role="tabpanel"
          aria-labelledby={`deeper-tab-${tab}`}
          tabIndex={0}
          className="flex grow flex-col gap-5 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.15, ease: "easeOut" } }}
          exit={{ opacity: 0, transition: { duration: 0.1, ease: "easeOut" } }}
        >
          {tab === "pay" ? <PayTab d={d} /> : tab === "slow" ? <SlowTab d={d} /> : <UnknownTab d={d} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
