import { AnimatePresence, motion } from "motion/react";
import { createContext, useContext, useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useRouteLoaderData } from "react-router";
import { roleWord } from "~/lib/activity";
import { programOf } from "~/lib/activities.server";
import { useReview } from "~/components/flow";
import { ArrowUp, HBar, Sparkle, Typewriter, VBar, cx, ease, money } from "~/components/ui";
import { useCoverageSteps } from "~/lib/coverage";
import { buildData, diagnoseData, exploreData, sayData } from "~/lib/data.server";
import type { Route } from "./+types/review.packet";
import type { ReviewLayoutData } from "./review";

export async function loader({ params }: Route.LoaderArgs) {
  const programId = await programOf(params);
  const [build, explore, diagnose, say] = await Promise.all([buildData(programId), exploreData(programId), diagnoseData(programId), sayData(programId)]);
  return { build, explore, diagnose, say };
}

/** Program name for every page header. */
const ProgramName = createContext("");

const PAGES = [
  ["Cover", "1"],
  ["Executive summary", "2 · from Diagnose"],
  ["What employers ask for", "3 · from Explore"],
  ["Where graduates go", "4 · Banner + alumni survey"],
  ["Employer voice", "5 · employer survey"],
  ["Recommended changes", "6 · from Build"],
  ["How we’ll tell students", "7 · defensible stats only"],
  ["Limits & sources", "8 · every claim labeled"],
] as const;

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six"];
/** The packet assistant is canned (no model is called): each request maps to a fixed, labelled edit. */
type Ask = { from: "you" | "ai"; text: string };
const CANNED_FALLBACK =
  "Canned demo: no model is called here. Try “Shorten for board”, “Check every claim” or “Add vote motion”, or accept the cost lines above.";

/** Each change carries its own cost note and short label (data.server changeCatalog). */
const costLabel = (c: { label: string }) => c.label.replace(/^\+\s*/, "");

function Page({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="print-page flex min-h-full w-[640px] flex-col gap-[22px] rounded-t-[10px] bg-white px-[52px] py-11 shadow-[0_1px_3px_rgba(0,0,0,0.05)] print:mb-10 print:break-after-page">
      <div className="flex justify-between font-mono text-[10px] uppercase leading-3 tracking-[0.06em] text-muted">
        <div>
          {String(n).padStart(2, "0")} · {title}
        </div>
        <div>NSSU · {useContext(ProgramName)}</div>
      </div>
      {children}
    </div>
  );
}

const H = ({ children, size = 26 }: { children: ReactNode; size?: 26 | 30 }) => (
  <div className={cx("font-semibold tracking-[-0.03em] text-ink", size === 30 ? "text-[30px] leading-[34px]" : "text-[26px] leading-[30px]")}>{children}</div>
);

type Kind = "data" | "survey" | "est";
const Tag = ({ kinds }: { kinds: Kind[] }) => (
  <span className="shrink-0 whitespace-nowrap font-mono text-[11px] leading-[14px] text-subtle">
    {kinds.map((k) => (k === "data" ? "● DATA" : k === "survey" ? "◐ SURVEY" : "◐ ESTIMATE")).join(" ")}
  </span>
);

export default function Packet({ loaderData: d }: Route.ComponentProps) {
  const layout = useRouteLoaderData("routes/review") as ReviewLayoutData | undefined;
  const surveyN = layout?.demo.packet.employers ?? 0;
  const { selected: stored, init } = useReview();
  const defaults = useMemo(() => Object.fromEntries(d.build.changes.map((c) => [c.id, c.defaultOn])), [d.build.changes]);
  useEffect(() => init(defaults), [defaults, init]);
  // Saved selections (server-rendered from the activity) over the defaults: no flash on first paint.
  const selected = useMemo(() => ({ ...defaults, ...stored }), [defaults, stored]);
  const { steps, deltas, final, start } = useCoverageSteps(d.build, selected);
  const [page, setPage] = useState(5);
  const [format, setFormat] = useState("Board packet");
  const [costs, setCosts] = useState(false);
  const [checking, setChecking] = useState(false);
  const [short, setShort] = useState(false);
  const [motionOn, setMotionOn] = useState(false);
  const [asks, setAsks] = useState<Ask[]>([]);
  const [draft, setDraft] = useState("");
  const askId = useId();
  const chosen = d.build.changes.filter((c) => selected[c.id]);
  const recent = d.say.cohorts.find((c) => c.cohort === "2020–25");
  const maxPost = d.explore.demand[0]?.posting_count ?? 1;
  const off = `${d.diagnose.offTrack} of ${d.diagnose.stats.matched}`;
  const program = d.build.program.name;
  const occ = d.build.occupation;
  const word = roleWord(occ.name);
  const offJobs = d.diagnose.offTrackJobs.map((j) => (/^Secretaries/.test(j) ? "admin" : /^Retail/.test(j) ? "retail" : j.split(",")[0].toLowerCase()));
  const offRoles = offJobs.length === 2 ? `${offJobs[0]} or ${offJobs[1]}` : offJobs[0] ?? "other";
  const holding = d.explore.targetHolders;
  const inFieldPct = d.diagnose.stats.in_field_known ? Math.round((100 * d.diagnose.stats.in_field) / d.diagnose.stats.in_field_known) : 0;
  const gapsTaught = d.explore.demand.filter((s) => !s.taught).length;

  // Evidence ledger: every claim rendered in the packet, by source. Survey items are synthetic (demo).
  const ledger = {
    data: 4 + 1 + 2 + chosen.length + 3,
    survey: 3,
    est: costs ? chosen.length : 0,
  };

  const changeDetail = (c: (typeof chosen)[number]) => {
    if (!c.skills.length) return `Targets placement: ${off} grads in ${offRoles} roles`;
    const names = d.build.bench.filter((b) => c.skills.includes(b.skill_id) && !d.build.taught.includes(b.skill_id)).map((b) => b.name);
    return `${names.length ? `Adds ${names.slice(0, 2).join(", ")} · ` : ""}coverage +${deltas[c.id] ?? 0} pts`;
  };

  const pages: ReactNode[] = [
    <Page key={0} n={1} title="Cover">
      <div className="flex min-h-[420px] flex-col justify-end gap-4 rounded-xl bg-red p-8 text-white">
        <div className="label text-white/70">Curriculum committee · December 12, 2026</div>
        <div className="text-[40px] font-semibold leading-[44px] tracking-[-0.035em]">{program} — program review</div>
        <div className="text-sm text-white/80">Prepared by Dean R. Okafor · School of Business · Data as of Dec 31, 2025</div>
      </div>
    </Page>,
    <Page key={1} n={2} title="Executive summary">
      <H size={30}>
        {WORDS[chosen.length] ?? chosen.length} change{chosen.length === 1 ? "" : "s"} narrow our {word} skills gap — without new courses.
      </H>
      {!short && (
        <div className="text-[15px] leading-6 text-text">
          {program} teaches {start}% of the skills King County employers list for {occ.name} —{" "}
          {holding ? `the role ${holding} of our matched graduates hold` : "a role none of our matched graduates hold yet"}. The changes below raise that to {final}%.
          Placement is the bigger issue: {off} matched alumni work in {offRoles} roles.
        </div>
      )}
      <div className="flex gap-6 border-t border-line pt-5">
        {[
          [`${start}% → ${final}%`, "skill coverage"],
          [`${inFieldPct}%`, "alumni in field"],
          [money(d.diagnose.stats.median_wage), "median alumni wage"],
        ].map(([v, l]) => (
          <div key={l} className="flex flex-1 flex-col">
            <div className="text-2xl font-semibold tracking-[-0.02em] text-ink">{v}</div>
            <div className="text-xs text-subtle">{l}</div>
          </div>
        ))}
      </div>
    </Page>,
    <Page key={2} n={3} title="What employers ask for">
      <H>
        {WORDS[gapsTaught] ?? gapsTaught} of the most-requested skills {gapsTaught === 1 ? "isn’t" : "aren’t"} taught.
      </H>
      <div className="flex flex-col gap-2.5">
        {d.explore.demand.map((s, i) => (
          <div key={s.skill_id} className="flex items-center gap-3">
            <div className={cx("w-[176px] shrink-0 text-pretty text-[13px] leading-4", s.taught ? "text-text" : "font-medium text-red")}>{s.name}</div>
            <HBar pct={(100 * s.posting_count) / maxPost} color={s.taught ? "bg-ink" : "bg-red"} track="bg-transparent" delay={i * 0.04} className="grow" />
            <div className="w-8 text-right font-mono text-xs text-subtle">{s.posting_count}</div>
          </div>
        ))}
      </div>
      <div className="text-xs text-muted">Postings per skill · {d.explore.postings.unique_postings} {occ.name} postings · King County · 2024</div>
    </Page>,
    <Page key={3} n={4} title="Where graduates go">
      <H>{recent?.pct}% of recent grads work in their field.</H>
      <div className="flex items-end gap-4 border-b border-ink" style={{ height: 150 }}>
        {d.say.cohorts.map((c, i) => (
          <div key={c.cohort} className="flex flex-1 flex-col items-center justify-end gap-1.5" style={{ height: 150 }}>
            <div className={cx("font-mono text-xs", i === d.say.cohorts.length - 1 ? "font-semibold text-red" : "text-subtle")}>{c.pct}%</div>
            <VBar height={c.pct * 1.2} radius={6} color={i === d.say.cohorts.length - 1 ? "bg-red" : i === 0 ? "bg-line" : "bg-ink"} delay={i * 0.08} />
          </div>
        ))}
      </div>
      <div className="flex gap-4 text-xs text-subtle">
        {d.say.cohorts.map((c) => (
          <div key={c.cohort} className="flex-1 text-center">
            {c.cohort} · {c.in_field}/{c.known}
          </div>
        ))}
      </div>
      <div className="flex flex-col border-t border-line">
        {d.explore.landing.map((l) => (
          <div key={l.name} className="flex justify-between gap-4 border-b border-line py-2 text-[13px]">
            <div className="truncate text-text">{l.name}</div>
            <div className="font-mono text-ink">{l.n}</div>
          </div>
        ))}
      </div>
    </Page>,
    <Page key={4} n={5} title="Employer voice">
      <div className="label inline-flex w-fit rounded-full border border-dashed border-muted px-3 py-1 text-subtle">Synthetic survey responses · demo</div>
      <H>Employers value communication more than postings suggest.</H>
      <div className="border-l-2 border-red px-4 py-1 text-[15px] leading-[22px] text-ink">
        “Strong on finance. They had to learn dashboards and presenting to clients on the job.”
        <div className="mt-1 text-xs text-subtle">Illustrative response · operations manager at a hiring employer</div>
      </div>
      <div className="flex gap-8">
        <div className="flex flex-col">
          <div className="text-4xl font-semibold tracking-[-0.04em] text-ink">
            {Math.max(0, surveyN - 1)} of {surveyN}
          </div>
          <div className="text-xs text-subtle">would hire another grad</div>
        </div>
        <div className="flex flex-col">
          <div className="text-4xl font-semibold tracking-[-0.04em] text-red">{Math.round(surveyN * 0.6)}</div>
          <div className="text-xs text-subtle">offered to host interns</div>
        </div>
      </div>
    </Page>,
    <Page key={5} n={6} title="Recommended changes">
      <H size={30}>
        {WORDS[chosen.length] ?? chosen.length} change{chosen.length === 1 ? "" : "s"}. No new courses, no new hires.
      </H>
      <div className="flex flex-col border-t border-ink">
        <AnimatePresence initial={false}>
          {chosen.map((c, i) => (
            <motion.div
              key={c.id}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.4, ease }}
              className="overflow-hidden border-b border-line"
            >
              <div className="flex gap-4 py-3.5">
                <div className="w-[22px] shrink-0 font-mono text-xs leading-4 text-red">{String(i + 1).padStart(2, "0")}</div>
                <div className="flex grow flex-col gap-[3px]">
                  <div className="text-sm font-semibold leading-[18px] text-ink">{c.short}</div>
                  <div className="text-xs leading-4 text-subtle">{changeDetail(c)}</div>
                  {/* The cost line's space is always reserved, so accepting or undoing it never moves the page. */}
                  <div aria-hidden={!costs} className={cx("truncate text-xs leading-4 text-red-deep transition-opacity duration-200 ease-out", costs ? "opacity-100" : "opacity-0")}>
                    Est. {c.cost}
                  </div>
                </div>
                <div className="w-[136px] shrink-0 text-right">
                  <Tag kinds={costs ? ["data", "est"] : ["data"]} />
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      {motionOn && (
        <div className="rounded-xl border border-ink px-4 py-3 text-[13px] leading-[19px] text-ink">
          <div className="label pb-1 text-[10px] text-muted">Motion for a vote</div>
          Moved: the curriculum committee approves the {chosen.length} change{chosen.length === 1 ? "" : "s"} above for {program}, effective fall 2027, with
          a coverage and placement check-in after one year.
        </div>
      )}
      <div className="flex shrink-0 items-end gap-3.5 pt-2" style={{ height: 110 }}>
        {steps.map((s, i) => {
          const last = i === steps.length - 1 && i > 0;
          return (
            <div key={s.label} className="flex flex-1 basis-0 flex-col items-center justify-end gap-1.5" style={{ height: 110 }}>
              <div className={cx("font-mono text-[11px] leading-[14px]", last ? "font-semibold text-red" : i === 0 ? "text-subtle" : "text-ink")}>{s.value}%</div>
              <VBar height={s.value} color={i === 0 ? "bg-line" : last ? "bg-red" : "bg-ink"} delay={0.1 + i * 0.08} />
            </div>
          );
        })}
        <div className="flex-[1.4] basis-0 pb-1 text-xs leading-[17px] text-subtle">
          Skill coverage vs. {d.build.postings} {occ.name} postings, King County 2024
        </div>
      </div>
      <div className="border-t border-line pt-1.5 text-[11px] leading-4 text-muted">
        ● Data: Lightcast postings and NSSU records.{" "}
        <span aria-hidden={!costs} className={cx("transition-opacity duration-200 ease-out", costs ? "opacity-100" : "opacity-0")}>
          ◐ Estimate: costs pending finance review.
        </span>{" "}
        ◐ Survey items in this packet use synthetic demo responses (n = {surveyN}). Coverage is skill overlap with postings, not a placement forecast.
      </div>
    </Page>,
    <Page key={6} n={7} title="How we’ll tell students">
      <H>Only claims we can defend.</H>
      <div className="flex flex-col gap-3 rounded-2xl bg-ink p-6 text-white">
        <div className="text-xl font-semibold leading-6">{recent?.pct}% of our recent grads work in their field.</div>
        <div className="text-[13px] leading-[19px] text-line">
          {d.say.topOcc && (
            <>
              · {d.say.topOcc.n} grads work as {d.say.topOcc.name.toLowerCase()}.
              <br />
            </>
          )}· {d.say.within3}% were hired within 3 months.
          <br />· {d.say.employers.length} employers have each hired 5 or more of our grads.
        </div>
      </div>
      <div className="text-xs text-muted">See the program’s Outcomes story for the full verified claim library.</div>
    </Page>,
    <Page key={7} n={8} title="Limits & sources">
      <H>What we are not claiming</H>
      <div className="text-[15px] leading-6 text-text">
        Skill coverage measures overlap with job postings. It does not prove these changes will raise enrollment or salaries. Employer survey figures in this prototype are
        synthetic.
      </div>
      <div className="flex flex-col gap-1.5 font-mono text-[11px] leading-[17px] text-subtle">
        <div>alumni-record.json — {d.diagnose.stats.alumni} program alumni</div>
        <div>occupation-benchmark.json — {occ.code} · King County · 2024</div>
        <div>posting-metrics.json — {d.build.postings} unique postings</div>
        <div>program.json · course.json — curriculum and taught skills</div>
      </div>
    </Page>,
  ];

  const reply = (you: string, ai: string) => setAsks((a) => [...a, { from: "you" as const, text: you }, { from: "ai" as const, text: ai }].slice(-6));
  const claims = ledger.data + ledger.survey + ledger.est;
  const actions = {
    shorten: () => {
      const next = !short;
      setShort(next);
      setPage(1);
      reply(next ? "Shorten for board" : "Restore the full summary", next ? "Cut page 2 to the headline and its three numbers." : "Restored the full paragraph on page 2.");
    },
    check: () => {
      setChecking(true);
      reply(
        "Check every claim",
        `Checked ${claims} claims: ${ledger.data} from data, ${ledger.survey} from demo survey responses, ${ledger.est} estimate${ledger.est === 1 ? "" : "s"}. None unsupported.`,
      );
    },
    motion: () => {
      const next = !motionOn;
      setMotionOn(next);
      setPage(5);
      reply(next ? "Add vote motion" : "Remove the vote motion", next ? "Added a motion for a vote under the changes on page 6." : "Removed the motion from page 6.");
    },
    costs: () => {
      setCosts(true);
      setPage(5);
      reply("Add cost lines", "Added a cost line to each change on page 6, labelled as estimates.");
    },
  };
  const ask = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    if (/short|trim|brief/i.test(text)) return actions.shorten();
    if (/claim|check|verif/i.test(text)) return actions.check();
    if (/motion|vote/i.test(text)) return actions.motion();
    if (/cost|budget|price/i.test(text)) return actions.costs();
    reply(text, CANNED_FALLBACK);
  };

  return (
    <ProgramName.Provider value={program}>
    <div className="flex grow items-stretch">
      <div className="no-print sticky top-[var(--stagebar-h)] flex h-[calc(100vh-var(--stagebar-h))] w-[280px] shrink-0 flex-col gap-1 self-start border-r border-line bg-white px-4 py-6">
        <div className="label px-2 pb-2.5 leading-[14px] text-muted">Packet · 8 pages</div>
        {PAGES.map(([t, s], i) => (
          <button
            key={t}
            type="button"
            onClick={() => setPage(i)}
            aria-current={page === i ? "page" : undefined}
            className="group relative flex items-center gap-2.5 rounded-lg p-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
          >
            {page === i && <motion.div layoutId="page-active" className="absolute inset-0 rounded-lg bg-surface" transition={{ type: "spring", duration: 0.25, bounce: 0 }} />}
            <div
              className={cx(
                "relative h-[38px] w-[30px] shrink-0 rounded-[3px] transition-colors",
                i === 0 ? "bg-red" : page === i ? "border-[1.5px] border-ink bg-white" : "border border-line bg-white group-hover:border-muted",
              )}
            />
            <div className="relative flex flex-col">
              <div className={cx("text-[13px] leading-4 text-ink", page === i && "font-semibold")}>{t}</div>
              <div className="text-[11px] leading-[14px] text-muted">{s}</div>
            </div>
          </button>
        ))}
        <div className="grow" />
        <div className="relative flex flex-col gap-2 rounded-xl bg-surface p-3.5 text-xs leading-4">
          {/* "Check every claim" pulses a ring (opacity only; no animated box-shadow). */}
          {checking && (
            <motion.div
              aria-hidden
              className="pointer-events-none absolute -inset-1 rounded-[14px] ring-4 ring-red/20"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 0] }}
              transition={{ duration: 1.2, ease: "easeInOut" }}
              onAnimationComplete={() => setChecking(false)}
            />
          )}
          <div className="font-mono text-[11px] uppercase leading-[14px] tracking-[0.04em] text-muted">Evidence check</div>
          {(
            [
              ["Data-backed claims", ledger.data, false],
              ["Survey-based (demo)", ledger.survey, false],
              ["Estimates", ledger.est, false],
              ["Unsupported", 0, true],
            ] as const
          ).map(([a, b, red]) => (
            <div key={a} className="flex justify-between">
              <div className="text-subtle">{a}</div>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div key={b} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} className={cx("font-mono", red ? "text-red" : "text-ink")}>
                  {b}
                </motion.div>
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>

      <div className="no-print flex min-w-0 grow justify-center overflow-hidden px-6 pt-7">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={page}
            className="flex"
            // Snappy: 100ms out, 180ms in (was 300 + 300ms). Small travel; reduced motion keeps only the fade.
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.18, ease } }}
            exit={{ opacity: 0, y: -3, transition: { duration: 0.1, ease: "easeOut" } }}
          >
            {pages[page]}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="hidden print:block">{pages}</div>

      <div className="no-print sticky top-[var(--stagebar-h)] flex h-[calc(100vh-var(--stagebar-h))] w-[340px] shrink-0 flex-col gap-4 self-start border-l border-line bg-white px-[22px] py-6">
        <div className="flex items-center gap-2">
          <Sparkle />
          <div className="label leading-[14px] text-subtle">Edit with AI</div>
          <span className="ml-auto rounded-full border border-dashed border-muted px-2 py-0.5 font-mono text-[10px] leading-3 text-subtle">canned · demo</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <div id={`${askId}-format`} className="text-xs leading-4 text-muted">
            Format
          </div>
          <div role="group" aria-labelledby={`${askId}-format`} className="flex gap-1.5">
            {["Board packet", "10 slides", "1-pager"].map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={format === f}
                onClick={() => setFormat(f)}
                className={cx(
                  "rounded-[14px] border px-3 py-1.5 text-xs leading-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
                  format === f ? "border-ink bg-ink text-white" : "border-line text-ink hover:border-ink",
                )}
              >
                {f}
              </button>
            ))}
          </div>
          {format !== "Board packet" && <p className="text-[11px] leading-4 text-muted">Demo: only the board packet layout is built. A {format.toLowerCase()} would reuse these pages.</p>}
        </div>
        <div className="h-px shrink-0 bg-line" />
        <div className="max-w-[250px] self-end rounded-[14px_14px_4px_14px] bg-ink px-3.5 py-2.5 text-[13px] leading-[19px] text-white">Add a cost line for each change — the provost will ask.</div>
        <AnimatePresence mode="wait" initial={false}>
          {!costs ? (
            <motion.div
              key="suggest"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15, ease: "easeOut" } }}
              transition={{ duration: 0.25, ease }}
              className="flex flex-col gap-2.5 rounded-xl border border-line p-3.5"
            >
              <div className="font-mono text-[11px] uppercase leading-[14px] tracking-[0.04em] text-muted">Suggested · page 6</div>
              <div className="min-h-[60px] whitespace-pre-line text-[13px] leading-5 text-ink">
                <Typewriter text={chosen.map((c, i) => `${String(i + 1).padStart(2, "0")} ${costLabel(c)} — ${c.cost}`).join("\n")} />
              </div>
              <div className="text-[11px] leading-4 text-red">◐ Costs are estimates — confirm with finance.</div>
              <div className="flex gap-2">
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  onClick={() => {
                    setCosts(true);
                    setPage(5);
                  }}
                  className="h-[30px] rounded-[15px] bg-red px-3.5 text-xs font-medium leading-4 text-white transition-colors hover:bg-red-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  Accept
                </motion.button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-between gap-2 rounded-xl bg-surface p-3.5 text-[13px] leading-[18px] text-ink"
            >
              <span>✓ Cost lines added to page 6, labeled as estimates.</span>
              <button type="button" onClick={() => setCosts(false)} className="shrink-0 rounded-sm text-xs text-subtle underline-offset-2 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink">
                Undo
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["Shorten for board", actions.shorten, short],
              ["Check every claim", actions.check, undefined],
              ["Add vote motion", actions.motion, motionOn],
            ] as const
          ).map(([c, run, pressed]) => (
            <motion.button
              key={c}
              type="button"
              aria-pressed={pressed}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
              onClick={run}
              className={cx(
                "rounded-[14px] border px-3 py-1.5 text-xs leading-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
                pressed ? "border-ink bg-surface text-ink" : "border-line text-ink hover:border-ink",
              )}
            >
              {pressed ? "✓ " : ""}
              {c}
            </motion.button>
          ))}
        </div>
        {/* Canned exchange log: every reply is fixed text (no model), and says so. */}
        <div role="log" aria-live="polite" aria-label="Packet assistant (canned demo)" className="flex min-h-0 grow flex-col justify-end gap-2 overflow-y-auto">
          {asks.map((m, i) =>
            m.from === "you" ? (
              <div key={i} className="max-w-[250px] self-end rounded-[14px_14px_4px_14px] bg-ink px-3.5 py-2 text-[13px] leading-[19px] text-white">
                {m.text}
              </div>
            ) : (
              <div key={i} className="flex flex-col gap-1 rounded-xl bg-surface px-3.5 py-2.5 text-[13px] leading-[18px] text-ink">
                <span>{m.text}</span>
                <span className="font-mono text-[10px] uppercase leading-3 tracking-[0.04em] text-muted">Canned reply · demo</span>
              </div>
            ),
          )}
        </div>
        <form
          onSubmit={ask}
          className="flex h-11 shrink-0 items-center gap-2 rounded-[22px] border border-ink pl-3.5 pr-1.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink"
        >
          <label htmlFor={askId} className="sr-only">
            Ask for an edit (canned demo replies)
          </label>
          <input
            id={askId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask for an edit…"
            autoComplete="off"
            className="min-w-0 grow bg-transparent text-[13px] leading-4 outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            aria-label="Send edit request"
            disabled={!draft.trim()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red transition-[background-color,opacity] duration-150 hover:bg-red-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
          >
            <ArrowUp />
          </button>
        </form>
      </div>
    </div>
    </ProgramName.Provider>
  );
}
