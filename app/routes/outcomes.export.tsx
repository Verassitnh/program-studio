import { AnimatePresence, motion } from "motion/react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useParams } from "react-router";
import { useRecordExport } from "~/components/activities";
import { Eyebrow, Toggle, VBar, cx } from "~/components/ui";
import { programOf } from "~/lib/activities.server";
import { storyClaims } from "~/lib/data.server";
import type { Route } from "./+types/outcomes.export";

export const loader = async ({ params }: Route.LoaderArgs) => storyClaims(await programOf(params));

type Format = "pdf" | "slides" | "embed" | "csv";

const FORMATS: { id: Format; badge: string; title: string; sub: string }[] = [
  { id: "pdf", badge: "PDF", title: "One-page story", sub: "Prospective students, counselors" },
  { id: "slides", badge: "PPT", title: "Slides with charts", sub: "Board, open house, faculty" },
  { id: "embed", badge: "</>", title: "Program page embed", sub: "Updates when data refreshes" },
  { id: "csv", badge: "CSV", title: "Data appendix", sub: "Every number, its n and its source" },
];

/** Groups smaller than this get flagged (mirrors SMALL_N in data.server). */
const SMALL_N = 10;

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/** Full-width primary action; same hover, press and focus as the shared Button. */
function Action({ children, href, onClick }: { children: ReactNode; href?: string; onClick?: () => void }) {
  const cls = cx("flex h-11 items-center justify-center rounded-full bg-ink text-sm font-medium text-white transition-colors duration-150 hover:bg-[#1c1c1c]", focusRing);
  const motionProps = { whileHover: { y: -1 }, whileTap: { scale: 0.96, y: 0 }, transition: { type: "spring" as const, duration: 0.3, bounce: 0 } };
  return href ? (
    <motion.a href={href} download className={cls} {...motionProps}>
      {children}
    </motion.a>
  ) : (
    <motion.button type="button" onClick={onClick} className={cls} {...motionProps}>
      {children}
    </motion.button>
  );
}

/** `max` pins the top of the scale (100 for percentages); otherwise bars are relative to the largest value. */
function MiniColumns({ values, labels, colors, summary, max: top, plot = 64 }: { values: number[]; labels: string[]; colors: string[]; summary: string; max?: number; plot?: number }) {
  const max = top ?? Math.max(...values, 1);
  return (
    <div role="img" aria-label={summary} className="flex flex-col gap-2">
      <div aria-hidden className="flex h-20 items-end gap-2 border-b border-ink">
        {values.map((v, i) => (
          <div key={i} className="flex flex-1 items-end">
            <VBar height={(plot * v) / max} color={colors[i]} radius={3} delay={0.1 + i * 0.08} />
          </div>
        ))}
      </div>
      <div aria-hidden className="flex gap-2 text-[9px] leading-3 text-subtle tabular-nums">
        {labels.map((l) => (
          <div key={l} className="flex-1 whitespace-pre-line text-center">
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Export({ loaderData }: Route.ComponentProps) {
  const { say, deep, headline, claims } = loaderData;
  const { activityId } = useParams();
  const recordExport = useRecordExport();
  const program = say.program.name;
  const slug = program.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const stages = deep.byStage.filter((s) => s.n > 0 && s.median != null) as { stage: string; n: number; median: number }[];
  const role = deep.occupation.name.replace(/s$/, "");
  const [format, setFormat] = useState<Format>("pdf");
  const [charts, setCharts] = useState(true);
  const [sources, setSources] = useState(true);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");
  const codeRef = useRef<HTMLElement>(null);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const k = (v: number | null) => (v == null ? "—" : `$${Math.round(v / 1000)}k`);
  const fast = say.within3 === 50 ? "Half" : `${say.within3}%`;
  const recent = say.cohorts.find((c) => c.cohort === "2020–25")!;
  const smallStages = stages.filter((s) => s.n < SMALL_N);
  const embed = `<script src="https://studio.lightcast.io/embed.js" data-story="nssu-${slug}" async></script>`;

  const cohorts = (
    <div className="flex flex-1 flex-col gap-2">
      <div className="text-[11px] font-semibold text-ink">In field, by class</div>
      <MiniColumns
        max={100}
        plot={72}
        values={say.cohorts.map((c) => c.pct)}
        labels={say.cohorts.map((c) => `${c.cohort}\n${c.pct}%`)}
        colors={["bg-line", "bg-ink", "bg-red"]}
        summary={`Working in field, by class: ${say.cohorts.map((c) => `${c.cohort}, ${c.pct}% (${c.in_field} of ${c.known})`).join("; ")}.`}
      />
    </div>
  );
  const pay = stages.length ? (
    <div className="flex flex-1 flex-col gap-2">
      <div className="text-[11px] font-semibold text-ink">{role} pay by career stage</div>
      <MiniColumns
        values={stages.map((s) => s.median)}
        labels={stages.map((s) => `${s.stage.replace(" years", " yrs")}\n${k(s.median)}${s.n < SMALL_N ? "*" : ""}`)}
        colors={["bg-subtle", "bg-ink", "bg-red"]}
        summary={`${role} median pay by career stage: ${stages.map((s) => `${s.stage}, ${k(s.median)} (${s.n} grads${s.n < SMALL_N ? ", small group" : ""})`).join("; ")}. Different grads at each stage.`}
      />
      {/* The stage caveat travels with the chart, even when sample sizes & sources are switched off. */}
      {!sources && (
        <div className="text-[9px] leading-3 text-subtle">
          Different grads at each stage{smallStages.length ? "; *small group" : ""}.
        </div>
      )}
    </div>
  ) : (
    <div className="flex flex-1 items-center rounded-md border border-dashed border-muted p-3 text-[10px] leading-[14px] text-subtle">
      Too few {role.toLowerCase()}s with annual pay to chart pay by career stage.
    </div>
  );

  const pdf = (
    <div className="print-page flex w-[600px] flex-col gap-5 rounded-t-md bg-white px-11 py-10 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-3.5 w-3.5 rounded-[3px] bg-ink" />
          <div className="text-[11px] font-semibold text-ink">North Sound State University</div>
        </div>
        <div className="label text-[9px] text-muted">School of Business · 2026</div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="label text-[10px] leading-3 tracking-[0.08em] text-red">{program}</div>
        <div className="text-[30px] font-semibold leading-[33px] tracking-[-0.035em] text-ink">{headline}</div>
      </div>
      <AnimatePresence initial={false}>
        {charts && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="flex gap-6 overflow-hidden">
            {cohorts}
            {pay}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex flex-col border-t border-line">
        {[
          ...(say.topOcc ? [[`Grads working as ${say.topOcc.name.toLowerCase()}`, String(say.topOcc.n)]] : []),
          ["Hired within 3 months of graduating", fast],
          ["Employers who hired 7+ of our grads", String(say.employers.filter((e) => e.n >= 7).length)],
          ...(pending ? [["Grads with outcomes still being collected", String(deep.unknown.n)]] : []),
        ].map(([a, b]) => (
          <motion.div layout key={a} className="flex justify-between border-b border-line py-[9px] text-xs">
            <div className="text-ink">{a}</div>
            <div className="font-semibold text-ink">{b}</div>
          </motion.div>
        ))}
      </div>
      {sources && (
        <div className="text-[9px] leading-[13px] text-subtle/85">
          Source: NSSU alumni records, 2011–2025, with a known job ({deep.stats.matched} of {deep.stats.alumni}). Recent = 2020–25 (n = {recent.known}). Pay groups are
          different graduates at different career stages
          {smallStages.map((s) => `; *${s.stage.replace(" years", " yrs")} n = ${s.n}`).join("")}. Data as of Dec 31, 2025. Past outcomes don’t guarantee future results.
        </div>
      )}
    </div>
  );

  const previews: Record<Format, React.ReactNode> = {
    pdf,
    slides: (
      <div className="flex flex-col gap-4">
        {[0, 1].map((s) => (
          <div key={s} className="print-page flex aspect-video w-[600px] flex-col gap-4 rounded-md bg-white p-9 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
            <div className="label text-[10px] text-red">{program} · {s + 1}/2</div>
            <div className="text-[26px] font-semibold leading-[30px] tracking-[-0.03em] text-ink">
              {s === 0 ? headline : stages.length > 1 && stages[stages.length - 1].median > stages[0].median ? `${role}s further into their careers earn more.` : `${role} pay by career stage.`}
            </div>
            <div className="flex grow items-end">{s === 0 ? cohorts : pay}</div>
            {sources && (
              <div className="text-[9px] leading-[13px] text-subtle/85">
                {s === 0
                  ? `Grads working in field / grads with a known job, by class. 2020–25 n = ${recent.known}.`
                  : `Different grads at each career stage, not the same people over time. n = ${stages.map((b) => b.n).join(" / ") || 0}${smallStages.length ? "; *small group" : ""}.`}
              </div>
            )}
          </div>
        ))}
      </div>
    ),
    embed: (
      <div className="flex w-[600px] flex-col gap-4">
        <pre className="whitespace-pre-wrap break-all rounded-xl bg-ink p-5 font-mono text-xs leading-5 text-line">
          <code ref={codeRef}>{embed}</code>
        </pre>
        <div className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-6">
          <div className="label text-[10px] text-subtle/85">Preview · nssu.edu/business</div>
          <div className="text-xl font-semibold tracking-[-0.02em] text-ink">{headline}</div>
          {charts && <div className="flex gap-6">{cohorts}</div>}
          {sources && (
            <div className="text-[9px] leading-[13px] text-subtle/85">
              NSSU alumni records. Recent = 2020–25 grads with a known job (n = {recent.known}). Data as of Dec 31, 2025.
            </div>
          )}
        </div>
      </div>
    ),
    csv: (
      <div role="table" aria-label="Data appendix preview" className="flex w-[600px] flex-col overflow-hidden rounded-xl border border-line bg-white">
        <div role="row" className="label grid grid-cols-[1fr_64px_72px] gap-3 border-b border-line bg-surface px-4 py-2.5 text-[10px] text-subtle">
          <div role="columnheader">Claim · note · source</div>
          <div role="columnheader">Value</div>
          <div role="columnheader" className="text-right">
            Count / n
          </div>
        </div>
        {claims.map((c, i) => (
          <motion.div
            key={c.claim}
            role="row"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: i * 0.04, duration: 0.3 }}
            className="grid grid-cols-[1fr_64px_72px] gap-3 border-b border-line px-4 py-2.5 text-xs tabular-nums"
          >
            <div role="cell" className="flex flex-col gap-0.5">
              <span className="text-ink">{c.claim}</span>
              <span className="text-[11px] leading-[14px] text-subtle">{c.note}</span>
              <span className="break-words font-mono text-[10px] text-subtle/85">{c.source}</span>
            </div>
            <div role="cell" className="font-mono text-ink">
              {c.value}
            </div>
            {/* Small groups get a word, not just the red color. */}
            <div role="cell" className={cx("flex flex-col items-end font-mono", c.n < SMALL_N ? "text-red-deep" : "text-subtle")}>
              <span>{c.count != null ? `${c.count} / ${c.n}` : `n ${c.n}`}</span>
              {c.n < SMALL_N && <span className="text-[10px]">small</span>}
            </div>
          </motion.div>
        ))}
      </div>
    ),
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(embed);
      setCopied("ok");
      setTimeout(() => setCopied("idle"), 1800);
    } catch {
      // Clipboard blocked: select the code so ⌘C / Ctrl+C works, and say so.
      const sel = window.getSelection();
      if (codeRef.current && sel) sel.selectAllChildren(codeRef.current);
      setCopied("failed");
    }
  };

  const action =
    format === "csv" ? (
      <Action href={`/a/${activityId}/outcomes/data.csv`}>Download CSV ↓</Action>
    ) : format === "embed" ? (
      <Action onClick={copy}>{copied === "ok" ? "✓ Copied" : "Copy embed code"}</Action>
    ) : (
      <Action
        onClick={() => {
          recordExport({ format: "pdf", artifact: format === "pdf" ? "outcomes-one-pager" : "outcomes-slides", label: `${program} · ${format === "pdf" ? "one-page story" : "slides"}` });
          window.print();
        }}
      >
        {format === "pdf" ? "Save as PDF ↓" : "Save slides as PDF ↓"}
      </Action>
    );

  // Format picker is a radio group: one Tab stop, arrows move and select.
  const onFormatKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = FORMATS.findIndex((f) => f.id === format);
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const n = (i + step + FORMATS.length) % FORMATS.length;
    setFormat(FORMATS[n].id);
    radios.current[n]?.focus();
  };

  return (
    <div className="flex grow">
      <div className="no-print flex w-[340px] shrink-0 flex-col gap-[18px] border-r border-line py-[26px] pl-12 pr-7">
        <div className="flex flex-col gap-1.5">
          <Eyebrow>Stage 4 · Export</Eyebrow>
          <h1 className="text-[26px] font-semibold leading-[31px] tracking-[-0.03em] text-ink">Take the story anywhere.</h1>
        </div>
        <div role="radiogroup" aria-labelledby="export-format" className="flex flex-col gap-2" onKeyDown={onFormatKey}>
          <div id="export-format" className="text-xs leading-4 text-subtle">
            Format
          </div>
          {FORMATS.map((f, i) => (
            <button
              key={f.id}
              ref={(el) => {
                radios.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={format === f.id}
              tabIndex={format === f.id ? 0 : -1}
              onClick={() => setFormat(f.id)}
              className={cx(
                "relative flex items-center gap-3 rounded-xl text-left transition-colors duration-150",
                focusRing,
                // The selected border is 0.5px heavier; padding gives it back so nothing shifts.
                format === f.id ? "border-[1.5px] border-ink px-[13.5px] py-[11.5px]" : "border border-line px-3.5 py-3 hover:border-muted",
              )}
            >
              <div
                className={cx(
                  "flex shrink-0 items-center justify-center rounded border-[1.5px] font-mono text-[9px] leading-3 transition-colors",
                  f.id === "pdf" ? "h-9 w-[30px]" : "h-[26px] w-9",
                  format === f.id ? "border-ink text-ink" : "border-muted text-subtle",
                )}
              >
                <span aria-hidden>{f.badge}</span>
              </div>
              <div className="flex grow flex-col">
                <div className={cx("text-sm leading-[18px] text-ink", format === f.id && "font-medium")}>{f.title}</div>
                <div className="text-xs leading-4 text-subtle">{f.sub}</div>
              </div>
              {/* Out of flow, beside the (short) title, so selecting a card never rewraps its subtitle. */}
              {format === f.id && (
                <motion.div aria-hidden layoutId="fmt-dot" className="absolute right-3.5 top-[17px] h-2 w-2 rounded-full bg-ink" transition={{ type: "spring", duration: 0.3, bounce: 0 }} />
              )}
            </button>
          ))}
        </div>
        <div role="group" aria-labelledby="export-include" className="flex flex-col gap-2.5">
          <div id="export-include" className="text-xs leading-4 text-subtle">
            Include
          </div>
          {(
            [
              ["Charts", charts, setCharts],
              ["Sample sizes & sources", sources, setSources],
              ["Items still waiting on data", pending, setPending],
            ] as const
          ).map(([l, v, set]) => (
            // The label names the switch and makes the whole row its hit area.
            <label key={l} className="flex cursor-pointer items-center justify-between text-[13px] text-ink [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-2 [&_button]:focus-visible:outline-ink">
              <span>{l}</span>
              <Toggle size="sm" on={v} onChange={set} />
            </label>
          ))}
        </div>
        <div className="grow" />
        {action}
        {/* Always mounted so screen readers announce the copy result. */}
        <p role="status" className={copied === "failed" ? "text-xs leading-4 text-subtle" : "sr-only"}>
          {copied === "ok" ? "Embed code copied." : copied === "failed" ? "Copy blocked by the browser. The code is selected: press ⌘C or Ctrl+C." : ""}
        </p>
      </div>
      <div className="flex grow justify-center overflow-y-auto bg-surface pt-[26px] print:bg-white">
        <AnimatePresence mode="wait" initial={false}>
          {/* Format switches are frequent: a short opacity fade, no movement. */}
          <motion.div
            key={format}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.15, ease: "easeOut" } }}
            exit={{ opacity: 0, transition: { duration: 0.1, ease: "easeOut" } }}
          >
            {previews[format]}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
