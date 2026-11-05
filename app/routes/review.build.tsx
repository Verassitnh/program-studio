import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useReview } from "~/components/flow";
import { Check, Eyebrow, Item, Sparkle, Stagger, cx, ease } from "~/components/ui";
import { useCoverageSteps } from "~/lib/coverage";
import { roleWord } from "~/lib/activity";
import { programOf } from "~/lib/activities.server";
import { buildData } from "~/lib/data.server";
import type { Route } from "./+types/review.build";

export const loader = async ({ params }: Route.LoaderArgs) => buildData(await programOf(params));

/** Number that tweens from its previous value (not from zero) whenever it changes. */
function Tween({ value, suffix = "", className }: { value: number; suffix?: string; className?: string }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => `${Math.round(v)}${suffix}`);
  const [display, setDisplay] = useState(`${value}${suffix}`);
  const reduce = useReducedMotion();
  useEffect(() => text.on("change", setDisplay), [text]);
  useEffect(() => {
    // Hidden tabs throttle animation frames; never leave a stale number waiting for them.
    if (reduce || document.visibilityState !== "visible") {
      mv.jump(value);
      return;
    }
    const c = animate(mv, value, { duration: 0.7, ease });
    return () => c.stop();
  }, [value, mv, reduce]);
  return <span className={cx("tabular-nums", className)}>{display}</span>;
}

const BAR = 1.47; // px per coverage point (design: 68% → 100px)

export default function Build({ loaderData: d }: Route.ComponentProps) {
  const { selected: stored, toggle, init, readOnly } = useReview();
  const defaults = useMemo(() => Object.fromEntries(d.changes.map((c) => [c.id, c.defaultOn])), [d.changes]);
  useEffect(() => init(defaults), [defaults, init]);
  // Saved selections come from the activity (server-rendered); with none saved, the defaults apply.
  const selected = useMemo(() => ({ ...defaults, ...stored }), [defaults, stored]);
  const { steps, deltas, final, start } = useCoverageSteps(d, selected);
  const chosen = d.changes.filter((c) => selected[c.id]);
  const edited = chosen.reduce((s, c) => s + c.courses.edited, 0);
  const added = chosen.reduce((s, c) => s + c.courses.added, 0);
  const H = 150; // as in the design; the tallest bar's label may sit above the box
  return (
    <div className="flex grow items-stretch">
      <Stagger className="flex min-w-0 grow flex-col gap-5 px-12 pb-10 pt-7">
        <Item className="flex flex-col gap-2.5">
          <Eyebrow>Stage 3 · Build changes</Eyebrow>
          <h1 className="text-[34px] font-semibold leading-10 tracking-[-0.03em] text-ink">Pick changes. Watch the program move.</h1>
          <p className="text-[15px] leading-[18px] text-subtle">Ordered from least to most effort. Each one reuses faculty and courses you already have.</p>
        </Item>
        <div className="flex flex-col gap-2.5">
          {d.changes.map((c, i) => {
            const on = !!selected[c.id];
            return (
              <motion.button
                key={c.id}
                type="button"
                aria-pressed={on}
                aria-disabled={readOnly || undefined}
                onClick={() => (readOnly ? undefined : toggle(c.id))}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.07, duration: 0.5, ease }}
                whileHover={readOnly ? undefined : { y: -2 }}
                whileTap={readOnly ? undefined : { scale: 0.995 }}
                className={cx(
                  "flex items-center gap-[18px] rounded-[14px] border bg-white px-5 py-[18px] text-left transition-[border-color] duration-150",
                  on ? "border-ink" : "border-line hover:border-muted",
                )}
              >
                <Check on={on} />
                <div className="flex min-w-0 grow flex-col gap-1">
                  <div className="text-[15px] font-semibold leading-[18px] text-ink">{c.title}</div>
                  <div className="text-[13px] leading-4 text-subtle">
                    {c.placement ? <span className="text-red-deep">From your data: </span> : null}
                    {c.detail}
                  </div>
                </div>
                <div className="shrink-0 whitespace-nowrap font-mono text-[11px] leading-[14px] tracking-[0.04em] text-subtle">{c.effort}</div>
                <div className="w-16 shrink-0 text-right">
                  {c.skills.length ? (
                    <motion.span
                      className={cx("inline-block text-xl font-semibold leading-6 tracking-[-0.02em] tabular-nums transition-[color] duration-150", on ? "text-red" : "text-muted")}
                      initial={false}
                      animate={{ scale: on ? 1 : 0.94 }}
                      transition={{ duration: 0.15, ease: "easeOut" }}
                    >
                      +{deltas[c.id] ?? 0}
                      <span className="sr-only"> coverage points</span>
                    </motion.span>
                  ) : (
                    <span className="text-xs leading-[15px] text-subtle">Placement</span>
                  )}
                </div>
              </motion.button>
            );
          })}
        </div>
      </Stagger>
      <div className="sticky top-[var(--stagebar-h)] flex h-[calc(100vh-var(--stagebar-h))] min-h-[560px] w-[380px] shrink-0 flex-col gap-[18px] self-start border-l border-line px-7 pb-7 pt-6">
        <div className="label leading-[14px] text-muted">Live impact · skill coverage</div>
        {/* One polite summary for screen readers; the big number and chart below are its visual form. */}
        <div role="status" className="sr-only">
          Skill coverage {final}%, from {start}%. {steps.map((s) => `${s.label.replace(/^\+\s*/, "plus ")}: ${s.value}%`).join(", ")}.
        </div>
        <div aria-hidden className="flex items-baseline gap-2.5">
          <Tween value={final} suffix="%" className="text-[72px] font-semibold leading-[72px] tracking-[-0.05em] text-red" />
          <div className="text-sm leading-[18px] text-subtle">from {start}%</div>
        </div>
        <div aria-hidden className="flex shrink-0 items-end gap-3.5 border-b border-line" style={{ height: H }}>
          <AnimatePresence initial={false} mode="popLayout">
            {steps.map((s, i) => {
              const last = i === steps.length - 1 && i > 0;
              return (
                <motion.div
                  key={s.label}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15, ease: "easeOut" } }}
                  transition={{ type: "spring", duration: 0.4, bounce: 0 }}
                  className="flex flex-1 basis-0 flex-col items-center justify-end gap-2"
                  style={{ height: H }}
                >
                  <div className={cx("font-mono text-xs leading-4 tabular-nums", last ? "font-semibold text-red" : i === 0 ? "text-subtle" : "text-ink")}>{s.value}</div>
                  <motion.div
                    className={cx("w-full rounded-t-lg transition-colors duration-300", i === 0 ? "bg-line" : last ? "bg-red" : "bg-ink")}
                    initial={{ height: 0 }}
                    animate={{ height: s.value * BAR }}
                    transition={{ duration: 0.8, ease }}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
        {/* Labels wrap instead of truncating when four steps share the width; two lines are reserved so toggling never shifts the rows below. */}
        <div aria-hidden className="-mt-3 flex min-h-8 gap-3.5 text-xs leading-4 text-subtle">
          {steps.map((s) => (
            <motion.div layout="position" key={s.label} className="min-w-0 flex-1 basis-0 text-center text-balance">
              {s.label.replace("+ ", "+ ")}
            </motion.div>
          ))}
        </div>
        <div className="flex flex-col gap-2.5 text-[13px] leading-4">
          {[
            ["Required credits", `${d.requiredCredits} → ${d.requiredCredits}`],
            ["New courses", String(added)],
            ["Courses edited", String(edited)],
          ].map(([a, b]) => (
            <div key={a} className="flex justify-between">
              <div className="text-subtle">{a}</div>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={b}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6, transition: { duration: 0.15, ease: "easeOut" } }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="font-mono tabular-nums text-ink"
                >
                  {b}
                </motion.div>
              </AnimatePresence>
            </div>
          ))}
        </div>
        <div className="grow" />
        <div className="flex gap-2.5 rounded-xl bg-surface px-3.5 py-3">
          <Sparkle className="mt-0.5" />
          <div className="text-[13px] leading-[18px] text-text">
            Kept required credits at {d.requiredCredits} with no new courses. Coverage is re-scored on {d.bench.length} weighted skills from {d.postings} {roleWord(d.occupation.name)}
            postings; internships target placement instead.
          </div>
        </div>
      </div>
    </div>
  );
}
