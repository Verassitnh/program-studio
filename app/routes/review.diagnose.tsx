import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams, useRouteLoaderData } from "react-router";
import { SurveyNudge } from "~/components/activities";
import { Eyebrow, Item, Sparkle, Stagger, cx, ease, useFirstPaint } from "~/components/ui";
import { roleWord } from "~/lib/activity";
import { programOf } from "~/lib/activities.server";
import { diagnoseData } from "~/lib/data.server";
import type { Route } from "./+types/review.diagnose";
import type { ReviewLayoutData } from "./review";

export const loader = async ({ params }: Route.LoaderArgs) => diagnoseData(await programOf(params));

/** "Business Administration — Operations, B.S." → "Operations"; the program itself → "Core degree". */
const concName = (program: string) => (n: string) =>
  n.startsWith(program) ? n.slice(program.length).replace(/^ — /, "").replace(/,\s*[A-Z.]+$/, "") || "Core degree" : n;
const OCC_SHORT: Record<string, string> = {
  "Secretaries and Administrative Assistants, Except Legal, Medical, and Executive": "admin",
  "Retail Salespersons": "retail",
};
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

function Verdict({ kind, delay }: { kind: "likely" | "easy" | "data"; delay: number }) {
  const cls =
    kind === "likely"
      ? "bg-red font-medium text-white"
      : kind === "easy"
        ? "border border-ink font-medium text-ink"
        : "bg-surface text-subtle";
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut", delay }}
      className={cx("flex h-[26px] items-center whitespace-nowrap rounded-[13px] px-3 text-xs leading-4", cls)}
    >
      {kind === "likely" ? "Likely cause" : kind === "easy" ? "Easy fix" : "Needs data"}
    </motion.div>
  );
}

/** Replays the agent's steps on arrival; a server-rendered first paint shows the finished run. */
function AgentRun({ steps }: { steps: { text: ReactNode; pending?: boolean }[] }) {
  const firstPaint = useFirstPaint();
  const [shown, setShown] = useState(firstPaint ? steps.length : 0);
  useEffect(() => {
    if (firstPaint) return;
    const id = setInterval(() => setShown((s) => (s >= steps.length ? (clearInterval(id), s) : s + 1)), 320);
    return () => clearInterval(id);
  }, [steps.length, firstPaint]);
  return (
    <ol className="flex flex-col gap-3.5 text-[13px] leading-[18px]">
      {steps.map((s, i) => {
        const done = i < shown;
        return (
          <motion.li key={i} className="flex gap-2.5" initial={false} animate={{ opacity: done ? 1 : 0.3 }} transition={{ duration: 0.3, ease }}>
            <div aria-hidden className={cx("relative w-4 shrink-0", s.pending ? "text-red" : "text-ink")}>
              {done ? (
                <motion.span className="inline-block" initial={{ scale: 0.25, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", duration: 0.3, bounce: 0 }}>
                  ✓
                </motion.span>
              ) : i === shown ? (
                <motion.span className="mt-[6px] inline-block h-1.5 w-1.5 rounded-full bg-red" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 0.9 }} />
              ) : (
                <span className="mt-[6px] inline-block h-1.5 w-1.5 rounded-full bg-line" />
              )}
            </div>
            <div className={s.pending ? "text-subtle" : "text-text"}>{s.text}</div>
          </motion.li>
        );
      })}
    </ol>
  );
}

export default function Diagnose({ loaderData: d }: Route.ComponentProps) {
  const layout = useRouteLoaderData("routes/review") as ReviewLayoutData | undefined;
  const { activityId } = useParams();
  const shortConc = concName(d.program.short);
  const word = roleWord(d.occupation.name);
  const jobs = d.offTrackJobs.map((j) => OCC_SHORT[j] ?? j.split(",")[0].toLowerCase());
  const answered = layout?.demo.diagnose.employers ?? 0;
  const presentation = Math.max(1, Math.round(answered * 0.37)); // simulated survey tally (demo)
  const matched = d.stats.matched;
  const offPct = matched ? Math.round((100 * d.offTrack) / matched) : 0;

  const conc = [...d.concentrations].sort((a, b) => b.score - a.score);
  const maxScore = Math.max(...conc.map((c) => c.score), 1);
  const minScore = conc.length ? Math.min(...conc.map((c) => c.score)) : 0;
  const core = d.concentrations.find((c) => shortConc(c.name) === "Core degree");
  const same = d.concentrations.filter((c) => c !== core && c.score === core?.score).map((c) => shortConc(c.name));
  const rest = d.concentrations.filter((c) => c !== core && c.score !== core?.score);
  const restScores = [...new Set(rest.map((c) => c.score))];
  const concText =
    core && same.length
      ? `${list(same)} align with ${word} postings exactly as the core degree does (${core.score}% each).${
          rest.length ? ` ${list(rest.map((c) => shortConc(c.name)))} ${restScores.length === 1 ? `score ${restScores[0]}%` : `score ${rest.map((c) => `${c.score}%`).join(", ")}`}.` : ""
        }`
      : conc.length > 1
        ? `All ${conc.length} options score between ${minScore}% and ${maxScore}% against ${word} postings.`
        : `${d.program.name} has no concentrations to compare${conc[0] ? ` (it scores ${conc[0].score}% against ${word} postings)` : ""}.`;

  const elsewhere = d.gaps.filter((g) => (d.gapCourses[g.skill_id] ?? 0) > 0);
  const nowhere = d.gaps.filter((g) => !(d.gapCourses[g.skill_id] ?? 0));
  const gapText = [
    elsewhere.length ? `${list(elsewhere.map((g) => g.name))} ${elsewhere.length > 1 ? "are" : "is"} taught elsewhere on campus` : "",
    nowhere.length ? `no course teaches ${list(nowhere.map((g) => g.name))}` : "",
  ]
    .filter(Boolean)
    .join("; ");

  const causes = [
    {
      n: "01",
      title: `Graduates aren't landing ${word} roles`,
      body: (
        <>
          {matched ? `${d.offTrack} of ${matched} matched alumni work in ${jobs.length ? list(jobs) : "other roles"}.` : "No alumni have a job on record yet."}{" "}
          <span className="text-red-deep">
            Survey: {presentation} of {answered} employers say grads had to learn client presentation on the job.
          </span>{" "}
          <span className="font-mono text-[11px] text-muted">DEMO</span>
        </>
      ),
      viz: (
        <div aria-hidden className="flex h-2.5 w-[180px] gap-0.5">
          <motion.div className="h-2.5 rounded-l-[5px] bg-ink" initial={{ width: 0 }} animate={{ width: `${100 - offPct}%` }} transition={{ duration: 0.9, ease, delay: 0.3 }} />
          <motion.div className="h-2.5 rounded-r-[5px] bg-red" initial={{ width: 0 }} animate={{ width: `${offPct}%` }} transition={{ duration: 0.7, ease, delay: 0.9 }} />
        </div>
      ),
      verdict: matched && offPct >= 20 ? ("likely" as const) : ("data" as const),
    },
    {
      n: "02",
      title: "Students can't tell the concentrations apart",
      body: <>{concText}</>,
      viz: (
        <div aria-hidden className="flex h-9 w-[180px] items-end gap-1.5" title={conc.map((c) => `${shortConc(c.name)} ${c.score}%`).join(" · ")}>
          {conc.map((c, i) => (
            <motion.div
              key={c.name}
              className={cx("w-[22px] shrink-0 rounded-[4px]", c.score === maxScore ? "bg-ink" : "bg-muted")}
              initial={{ height: 0 }}
              animate={{ height: 36 * (c.score / maxScore) }}
              transition={{ duration: 0.7, ease, delay: 0.45 + i * 0.07 }}
            />
          ))}
        </div>
      ),
      verdict: conc.length > 1 ? ("likely" as const) : ("data" as const),
    },
    {
      n: "03",
      title: d.gaps.length ? `${d.gaps.length === 2 ? "Two" : "One"} in-demand skill${d.gaps.length === 1 ? " is" : "s are"} missing` : "No top skill is missing",
      body: d.gaps.length ? (
        <>
          {d.gaps.map((g, i) => (i === 0 ? `${g.name} (${g.posting_count} postings)` : `${g.name} (${g.posting_count})`)).join(" and ")} {d.gaps.length === 1 ? "isn't" : "aren't"} taught.{" "}
          {gapText.charAt(0).toUpperCase() + gapText.slice(1)}.
        </>
      ) : (
        <>The curriculum already teaches every top skill {word} postings ask for.</>
      ),
      viz: (
        <div className="flex w-[180px] flex-col gap-[5px]">
          <div aria-hidden className="relative h-1.5 overflow-hidden rounded-[3px] bg-line">
            <motion.div className="absolute inset-y-0 left-0 rounded-[3px] bg-red/25" initial={{ width: 0 }} animate={{ width: `${d.possible}%` }} transition={{ duration: 0.9, ease, delay: 1 }} />
            <motion.div className="absolute inset-y-0 left-0 rounded-[3px] bg-ink" initial={{ width: 0 }} animate={{ width: `${d.coverage}%` }} transition={{ duration: 0.9, ease, delay: 0.55 }} />
          </div>
          <div className="font-mono text-[11px] leading-[14px] tabular-nums text-subtle">
            {d.coverage}% skill coverage → {d.possible}% possible
          </div>
        </div>
      ),
      verdict: d.gaps.length ? ("easy" as const) : ("data" as const),
    },
    {
      n: "04",
      title: "Fewer students are coming in",
      body: <>Banner enrollment table not shared yet. Transfer is a lead: {d.transfer} NSSU alumni started at Spokane Valley CC.</>,
      viz: (
        // Sources are connected once, in setup / Integrations; nothing here can sync on its own.
        <Link
          to="/integrations"
          prefetch="intent"
          className="flex h-7 w-[180px] items-center justify-center rounded-lg border border-dashed border-muted text-xs leading-4 text-subtle transition-[border-color,color] duration-150 hover:border-subtle hover:text-ink"
        >
          Sync enrollment from Banner
        </Link>
      ),
      verdict: "data" as const,
      muted: true,
    },
  ];

  return (
    <div className="flex grow items-stretch">
      <Stagger className="flex min-w-0 grow flex-col gap-5 px-12 pb-6 pt-7">
        <Item className="flex flex-col gap-2.5">
          <Eyebrow>Stage 2 · Diagnose</Eyebrow>
          <h1 className="text-[34px] font-semibold leading-10 tracking-[-0.03em] text-ink">Why is {d.program.short} losing students?</h1>
          <p className="max-w-[640px] text-[15px] leading-[22px] text-subtle">
            {(() => {
              const likely = causes.filter((c) => c.verdict === "likely").length;
              const easy = causes.filter((c) => c.verdict === "easy").length;
              return likely === 2 && easy === 1
                ? "The agent checked four possible causes against your data. Two are likely causes — one of them isn't the curriculum — and a third is an easy fix."
                : `The agent checked four possible causes against your data: ${likely} likely, ${easy} easy to fix, the rest need more data.`;
            })()}
          </p>
        </Item>
        <Item className="flex flex-col border-t border-line">
          {causes.map((c, i) => (
            <motion.div
              key={c.n}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.08, duration: 0.5, ease }}
              className="flex items-center gap-7 border-b border-line py-[22px]"
            >
              <div className="w-7 shrink-0 font-mono text-xs leading-4 text-muted">{c.n}</div>
              <div className="flex min-w-0 grow flex-col gap-1">
                <div className={cx("text-[17px] font-semibold leading-[22px] tracking-[-0.01em]", c.muted ? "text-subtle" : "text-ink")}>{c.title}</div>
                <div className={cx("text-[13px] leading-[19px]", c.muted ? "text-muted" : "text-subtle")}>{c.body}</div>
              </div>
              <div className="w-[180px] shrink-0">{c.viz}</div>
              <div className="flex w-[130px] shrink-0 justify-end">
                <Verdict kind={c.verdict} delay={0.6 + i * 0.12} />
              </div>
            </motion.div>
          ))}
        </Item>
      </Stagger>
      <div className="sticky top-[var(--stagebar-h)] flex h-[calc(100vh-var(--stagebar-h))] w-[340px] shrink-0 flex-col gap-5 self-start border-l border-line bg-surface px-6 py-7">
        <div className="flex items-center gap-2">
          <Sparkle />
          <div className="label leading-[14px] text-subtle">Agent run · 14 sec</div>
        </div>
        <AgentRun
          steps={[
            { text: `Read ${d.programCourses} courses and ${d.taughtSkills} taught skills` },
            { text: `Pulled ${d.postings} ${d.occupation.name} postings, King County 2024` },
            { text: `Matched ${d.stats.matched} of ${d.stats.alumni} alumni to current jobs` },
            { text: `Compared ${conc.length} concentrations side by side` },
            { text: `Searched ${d.campusCourses.toLocaleString()} campus courses for missing skills` },
            {
              text: (
                <>
                  Employer survey — {answered} answers in, confirms cause 01 <span className="font-mono text-[11px] text-muted">DEMO</span>
                </>
              ),
              pending: true,
            },
          ]}
        />
        <SurveyNudge programId={layout?.frame.programId ?? ""} unknown={d.stats.alumni - d.stats.matched} survey={layout?.surveys.alumni ?? null} className="bg-white" />
        <div className="h-px shrink-0 bg-line" />
        <div className="flex flex-col gap-2">
          <div className="text-[13px] font-semibold leading-4 text-ink">What this can't tell you</div>
          <div className="text-xs leading-[18px] text-subtle">
            Skill coverage shows overlap with job postings, not job readiness. Alumni outcomes are correlations, not proof that a curriculum change will raise placement.
          </div>
        </div>
        <div className="grow" />
        <Link to={`/a/${activityId}/review/build`} prefetch="intent" className="group text-center text-xs leading-4 text-subtle transition-colors hover:text-ink">
          Next: Build changes{" "}
          <span aria-hidden className="inline-block transition-[translate] duration-150 ease-out group-hover:translate-x-0.5">
            →
          </span>
        </Link>
      </div>
    </div>
  );
}
