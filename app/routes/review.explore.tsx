import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, CountUp, HBar, Item, Sparkle, Stagger, cx, ease, money, useFirstPaint } from "~/components/ui";
import { useRouteLoaderData } from "react-router";
import { SurveyNudge } from "~/components/activities";
import { roleWord } from "~/lib/activity";
import { programOf } from "~/lib/activities.server";
import { exploreData } from "~/lib/data.server";
import type { Route } from "./+types/review.explore";
import type { ReviewLayoutData } from "./review";

export const loader = async ({ params }: Route.LoaderArgs) => exploreData(await programOf(params));

type Data = Route.ComponentProps["loaderData"];
type Seg = { text: string; strong?: boolean };
type Msg = { from: "you" | "agent"; parts: Seg[][] };

const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);

/** Display-only abbreviations so long taxonomy names fit the chart lanes. */
const SKILL_SHORT: Record<string, string> = { "Organizational behavior": "Org. behavior", "Reading Comprehension": "Reading comp." };
const OCC_SHORT: Record<string, string> = {
  "Secretaries and Administrative Assistants, Except Legal, Medical, and Executive": "Secretaries & admin. assistants",
  "Retail Salespersons": "Retail salespersons",
  "Customer Service Representatives": "Customer service reps",
};
const shortOcc = (n: string) => OCC_SHORT[n] ?? n.split(",")[0];

/**
 * Typewriter that keeps inline emphasis: types across paragraphs and bold segments.
 * Server-rendered text and reduced-motion users get the full message at once. Screen readers get the
 * whole message from a visually hidden copy, so the agent log announces it once rather than per keystroke.
 */
function TypeRich({ paras, delay = 250, speed = 12 }: { paras: Seg[][]; delay?: number; speed?: number }) {
  const total = paras.flat().reduce((s, p) => s + p.text.length, 0);
  const firstPaint = useFirstPaint();
  const reduce = useReducedMotion();
  const [n, setN] = useState(firstPaint ? total : 0);
  useEffect(() => {
    if (firstPaint || reduce) {
      setN(total);
      return;
    }
    setN(0);
    let timer: ReturnType<typeof setInterval>;
    const start = setTimeout(() => {
      timer = setInterval(() => setN((v) => (v >= total ? (clearInterval(timer), v) : v + 2)), speed);
    }, delay);
    return () => {
      clearTimeout(start);
      clearInterval(timer);
    };
  }, [total, delay, speed, firstPaint, reduce]);
  let left = n;
  return (
    <>
    <div className="sr-only">{paras.map((segs) => segs.map((s) => s.text).join("")).join(" ")}</div>
    <div aria-hidden className="flex flex-col gap-2.5">
      {paras.map((segs, i) => {
        if (left <= 0 && i > 0) return null;
        return (
          <div key={i} className="text-[13px] leading-5 text-text">
            {segs.map((s, j) => {
              const shown = s.text.slice(0, Math.max(0, left));
              left -= s.text.length;
              return s.strong ? (
                <span key={j} className="font-semibold text-ink">
                  {shown}
                </span>
              ) : (
                <span key={j}>{shown}</span>
              );
            })}
          </div>
        );
      })}
    </div>
    </>
  );
}

function AgentPanel({ d, offTrack }: { d: Data; offTrack: number }) {
  const matched = d.stats.matched;
  const oursInField = pct(d.stats.in_field, d.stats.in_field_known);
  const first = d.cohorts.find((c) => c.known);
  const last = [...d.cohorts].reverse().find((c) => c.known);
  const word = roleWord(d.occupation.name);
  const elsewhere = d.landing.filter((l) => !l.target && l.name !== "Other roles").map((l) => shortOcc(l.name).toLowerCase());
  const peerReply: Record<string, Seg[][]> = d.peer
    ? {
        [`Compare with ${d.peer.name.replace(/ College$/, "")}`]: [
          [
            { text: `${d.peer.name}'s ${d.program.name} places ` },
            { text: `${pct(d.peer.stats.in_field, d.peer.stats.in_field_known)}% in field`, strong: true },
            { text: ` (${d.peer.stats.in_field}/${d.peer.stats.in_field_known}) vs. ${oursInField}% here, with a median alumni wage of ${money(d.peer.stats.median_wage)} vs. ${money(d.stats.median_wage)}.` },
          ],
          [{ text: `Hired within 6 months: ${pct(d.peer.ttj.within6, d.peer.ttj.n)}% there, ${pct(d.ttj.within6, d.ttj.n)}% here. Small samples — treat as directional.` }],
        ],
      }
    : {};
  const replies: Record<string, Seg[][]> = {
    "Split by grad year": [
      [
        { text: "In-field rate by class: " },
        { text: d.cohorts.map((c) => `${c.pct}% for ${c.cohort}`).join(", "), strong: true },
        { text: ` (${d.cohorts.map((c) => `${c.in_field}/${c.known}`).join(", ")} known).` },
      ],
      [{ text: last && first && last !== first && last.pct > first.pct ? "The recent cohort is the strongest story." : "No clear improvement across cohorts yet." }],
    ],
    ...peerReply,
    [`Survey the ${d.unmatched} unknowns`]: [
      [
        { text: `${d.unmatched} alumni have no job on record; ` },
        { text: `${d.unmatchedReachable} of them are reachable`, strong: true },
        { text: " by email or LinkedIn. I've queued them for the alumni survey." },
      ],
    ],
  };
  const [msgs, setMsgs] = useState<Msg[]>([
    { from: "you", parts: [[{ text: `Show me where our grads end up vs. what ${word} employers want.` }]] },
    {
      from: "agent",
      parts: [
        [{ text: "Added two charts to your dashboard." }],
        !matched
          ? [{ text: `The curriculum covers ${d.coverage}% of what ${word} postings ask for. No alumni have a job on record yet, so placement can't be judged: survey them first.` }]
          : offTrack && d.coverage >= 60
            ? [
                { text: `The curriculum is a decent match (${d.coverage}%), but ` },
                { text: `${offTrack} of ${matched} matched alumni work as ${elsewhere.join(" or ")}`, strong: true },
                { text: ". That looks more like a placement and positioning problem than a curriculum one." },
              ]
            : [
                { text: `The curriculum covers ${d.coverage}% of what ${word} postings ask for` },
                { text: offTrack ? `, and ${offTrack} of ${matched} matched alumni work as ${elsewhere.join(" or ")}` : "", strong: true },
                { text: d.coverage < 60 ? ". Closing the skill gaps comes first." : "." },
              ],
      ],
    },
  ]);
  const [used, setUsed] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length]);
  const ask = (text: string) => {
    const reply = replies[text] ?? [[{ text: "I can only answer from the alumni and postings data in this demo — try one of the suggestions." }]];
    setMsgs((m) => [...m, { from: "you", parts: [[{ text }]] }, { from: "agent", parts: reply }]);
    if (replies[text]) setUsed((u) => [...u, text]);
    setInput("");
  };
  const chips = Object.keys(replies).filter((c) => !used.includes(c));
  return (
    <div className="sticky top-[var(--stagebar-h)] flex h-[calc(100vh-var(--stagebar-h))] w-[340px] shrink-0 flex-col gap-[18px] border-l border-line px-5 py-6">
      <div className="flex items-center gap-2">
        <Sparkle />
        <div className="label leading-[14px] text-subtle">Dashboard agent</div>
      </div>
      <div ref={scroller} role="log" aria-label="Dashboard agent conversation" className="-mx-1 flex min-h-0 grow flex-col gap-[18px] overflow-y-auto overscroll-contain px-1">
        <AnimatePresence initial={false}>
          {msgs.map((m, i) =>
            m.from === "you" ? (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.35, ease }}
                className="max-w-[250px] shrink-0 self-end rounded-[14px_14px_4px_14px] bg-ink px-3.5 py-2.5 text-[13px] leading-[19px] text-white"
              >
                {m.parts[0][0].text}
              </motion.div>
            ) : (
              <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} className="flex shrink-0 flex-col gap-2.5">
                <TypeRich paras={m.parts} />
                {i === 1 && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.6, duration: 0.4, ease }}
                    className="flex flex-col gap-1.5 rounded-[10px] bg-surface px-3 py-2.5 text-xs leading-5 text-subtle"
                  >
                    <div className="flex justify-between">
                      <div>alumni-record.json</div>
                      <div className="font-mono">{d.stats.alumni} rows</div>
                    </div>
                    <div className="flex justify-between gap-3">
                      <div>occupation-benchmark.json</div>
                      <div className="font-mono">King Co · 2024</div>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            ),
          )}
        </AnimatePresence>
        <motion.div layout className="flex flex-wrap gap-1.5">
          <AnimatePresence initial={false}>
            {chips.map((c) => (
              <motion.button
                key={c}
                layout
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.15, ease: "easeOut" } }}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.96 }}
                type="button"
                onClick={() => ask(c)}
                className="rounded-[14px] border border-line px-3 py-1.5 text-xs leading-4 text-ink transition-[border-color] duration-150 hover:border-ink"
              >
                {c}
              </motion.button>
            ))}
          </AnimatePresence>
        </motion.div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) ask(input.trim());
        }}
        // The input draws no ring of its own; the pill shows focus for the whole field.
        className="flex h-11 shrink-0 items-center gap-2 rounded-[22px] border border-ink pl-3.5 pr-1.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus has-[button:focus-visible]:outline-none"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="Ask the dashboard agent"
          placeholder="Add a chart, ask a question…"
          className="min-w-0 grow bg-transparent text-[13px] leading-4 outline-none placeholder:text-muted"
        />
        <motion.button type="submit" aria-label="Send" whileTap={{ scale: 0.96 }} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red">
          <ArrowUp />
        </motion.button>
      </form>
    </div>
  );
}

/** `width` is the design width; KPIs shrink below it (and their notes wrap) rather than run under the agent panel. */
function Kpi({ label, children, sub, width }: { label: string; children: React.ReactNode; sub: React.ReactNode; width: number }) {
  return (
    <div className="flex min-w-0 shrink grow-0 flex-col gap-1" style={{ flexBasis: width }}>
      <div className="label leading-[14px] text-muted">{label}</div>
      <div className="flex items-baseline gap-2">{children}</div>
      <div className="text-xs leading-4 text-pretty text-muted">{sub}</div>
    </div>
  );
}

const TABS = ["Overview", "Curriculum", "Alumni", "Employers", "Activity"];

/** APG tabs: one Tab stop, arrow keys / Home / End move between tabs and activate them. */
function Tabs({ tab, setTab }: { tab: string; setTab: (t: string) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = TABS.length;
    const next = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next]);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label="Dashboard views" className="flex gap-6">
      {TABS.map((t, i) => (
        <button
          key={t}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`explore-tab-${i}`}
          aria-selected={tab === t}
          aria-controls="explore-panel"
          tabIndex={tab === t ? 0 : -1}
          onClick={() => setTab(t)}
          onKeyDown={(e) => onKey(e, i)}
          className={cx("relative pb-2.5 text-sm leading-[18px] transition-colors duration-150", tab === t ? "font-medium text-ink" : "text-subtle hover:text-ink")}
        >
          {t}
          {tab === t && <motion.div layoutId="explore-tab" className="absolute -bottom-px left-0 right-0 h-0.5 bg-ink" transition={{ type: "spring", duration: 0.3, bounce: 0 }} />}
        </button>
      ))}
    </div>
  );
}

const big = "text-5xl font-semibold leading-[52px] tracking-[-0.04em]";

export default function Explore({ loaderData: d }: Route.ComponentProps) {
  const layout = useRouteLoaderData("routes/review") as ReviewLayoutData | undefined;
  const [tab, setTab] = useState("Overview");
  const maxPost = d.demand[0]?.posting_count || 1;
  const maxLand = Math.max(...d.landing.map((l) => l.n), d.unmatched, 1);
  const answered = layout?.surveys.alumni?.responses ?? 0;
  const offTrack = d.landing.filter((l) => !l.target && l.name !== "Other roles").reduce((s, l) => s + l.n, 0);
  return (
    <div className="flex grow items-start">
      <Stagger className="flex min-w-0 grow flex-col gap-7 px-10 py-8">
        <Item className="border-b border-line">
          <Tabs tab={tab} setTab={setTab} />
        </Item>
        <div role="tabpanel" id="explore-panel" aria-labelledby={`explore-tab-${TABS.indexOf(tab)}`} className="flex flex-col gap-7">
        {tab !== "Overview" && (
          <p className="-mb-3 text-xs leading-4 text-muted">The {tab} view isn't part of this prototype. Showing the Overview charts.</p>
        )}
        <Item>
          <SurveyNudge programId={layout?.frame.programId ?? ""} unknown={d.unmatched} survey={layout?.surveys.alumni ?? null} />
        </Item>
        <Item className="flex gap-12">
          <Kpi label="Skill coverage" width={250} sub={`vs. ${d.occupation.name} postings`}>
            <CountUp value={d.coverage} format={(v) => `${Math.round(v)}%`} className={cx(big, "text-red")} />
            <div className="whitespace-nowrap text-[13px] leading-4 text-subtle">→ {d.possible}% possible</div>
          </Kpi>
          <Kpi
            label="Alumni in field"
            width={250}
            sub={
              <>
                {d.unmatched} unknown
                {answered > 0 && (
                  <>
                    {" "}
                    · <span className="text-red">{answered} answered the alumni survey</span> <span className="text-muted">(demo)</span>
                  </>
                )}
              </>
            }
          >
            <CountUp value={pct(d.stats.in_field, d.stats.in_field_known)} format={(v) => `${Math.round(v)}%`} className={cx(big, "text-ink")} />
            <div className="whitespace-nowrap text-[13px] leading-4 text-subtle">
              {d.stats.in_field} of {d.stats.in_field_known}
            </div>
          </Kpi>
          <Kpi label="Median alumni wage" width={240} sub={<>Market median for the target role: {money(d.postings.median_salary)}</>}>
            <CountUp value={d.stats.median_wage ?? 0} format={(v) => money(v)} className={cx(big, "text-ink")} />
            <div className="whitespace-nowrap text-[13px] leading-4 text-subtle">n = {d.stats.wage_n}</div>
          </Kpi>
        </Item>
        <Item className="flex gap-10">
          <div className="flex min-w-0 flex-1 basis-0 flex-col gap-4">
            <div className="flex items-baseline justify-between">
              <div className="text-base font-semibold leading-5 tracking-[-0.01em] text-ink">What employers ask for</div>
              <div className="flex gap-3.5 text-xs leading-4 text-subtle">
                <div className="flex items-center gap-1.5">
                  <div aria-hidden className="h-2 w-2 rounded-[2px] bg-ink" />
                  Taught
                </div>
                <div className="flex items-center gap-1.5">
                  <div aria-hidden className="h-2 w-2 rounded-[2px] bg-red" />
                  Gap
                </div>
              </div>
            </div>
            {/* Each row reads as text: name, taught or gap (not colour alone), posting count. Bars are decoration. */}
            <ul className="flex flex-col gap-[11px]">
              {d.demand.map((s, i) => (
                <li key={s.skill_id} className="flex items-center gap-3" title={s.name}>
                  <div className={cx("w-[130px] shrink-0 truncate text-[13px] leading-4", s.taught ? "text-text" : "font-medium text-red")}>
                    <span aria-hidden>{SKILL_SHORT[s.name] ?? s.name}</span>
                    <span className="sr-only">
                      {s.name}, {s.taught ? "taught" : "gap, not taught"},
                    </span>
                  </div>
                  <div aria-hidden className="flex min-w-0 grow">
                    <HBar pct={(100 * s.posting_count) / maxPost} track="bg-transparent" color={s.taught ? "bg-ink" : "bg-red"} delay={0.2 + i * 0.05} />
                  </div>
                  <div className="w-[34px] shrink-0 text-right font-mono text-xs leading-4 tabular-nums text-subtle">
                    {s.posting_count}
                    <span className="sr-only"> postings</span>
                  </div>
                </li>
              ))}
            </ul>
            {d.demand.length === 0 && <p className="text-[13px] text-subtle">No King County skills benchmark for {d.occupation.name} in 2024.</p>}
            <div className="text-xs leading-4 text-muted">Postings per skill · {d.occupation.name} · King County · 2024</div>
          </div>
          <div className="flex min-w-0 flex-1 basis-0 flex-col gap-4">
            <div className="text-base font-semibold leading-5 tracking-[-0.01em] text-ink">Where graduates land</div>
            <ul className="flex flex-col gap-3.5">
              {d.landing.map((l, i) => (
                <li key={l.name} className="flex flex-col gap-1.5" title={l.name}>
                  <div className="flex justify-between gap-3 text-[13px] leading-4">
                    <div className={cx("truncate", l.target ? "font-medium text-ink" : "text-text")}>
                      <span aria-hidden>{shortOcc(l.name)}</span>
                      <span className="sr-only">{l.name}</span>
                      {l.target && <span className="ml-2 font-mono text-[11px] uppercase leading-[14px] tracking-[0.04em] text-red">Target</span>}
                    </div>
                    <div className="font-mono tabular-nums text-ink">
                      {l.n}
                      <span className="sr-only"> alumni</span>
                    </div>
                  </div>
                  <div aria-hidden>
                  <HBar
                    pct={(100 * l.n) / maxLand}
                    h={22}
                    track="bg-surface"
                    className="rounded-[4px]"
                    color={cx(l.target ? "bg-red" : l.name === "Other roles" ? "bg-muted" : "bg-ink", "rounded-[4px]")}
                    delay={0.25 + i * 0.07}
                  />
                  </div>
                </li>
              ))}
              <li className="flex flex-col gap-1.5">
                <div className="flex justify-between text-[13px] leading-4">
                  <div className="text-subtle">No employment match</div>
                  <div className="font-mono tabular-nums text-subtle">
                    {d.unmatched}
                    <span className="sr-only"> alumni</span>
                  </div>
                </div>
                <div aria-hidden className="flex h-[22px] rounded-[4px] border border-dashed border-muted">
                  <motion.div
                    className="hatch h-full rounded-[4px]"
                    initial={{ width: 0 }}
                    animate={{ width: `${(100 * d.unmatched) / maxLand}%` }}
                    transition={{ duration: 0.9, ease, delay: 0.6 }}
                  />
                </div>
              </li>
            </ul>
            <div className="text-xs leading-4 text-muted">
              Current occupation of {d.stats.alumni} alumni (2011–2025 graduates)
            </div>
          </div>
        </Item>
        </div>
      </Stagger>
      <AgentPanel d={d} offTrack={offTrack} />
    </div>
  );
}
