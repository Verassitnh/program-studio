import { useRef, type ReactNode } from "react";
import { Link } from "react-router";
import { StatusLabel } from "~/components/activities";
import { cx } from "~/components/ui";
import { PanelHeader, SmallN } from "~/components/workspace/kit";
import { KindIcon, NextStep } from "./actions";
import { fmtDate, fmtGrowth, fmtMoney, fmtNum, levelLabel, plural, rate, type Career, type ProgramDetail, type ProgramRow } from "./model";

/* ---------------------------------------------------------------- resizing */

export const PANEL_DEFAULT = 560;
export const PANEL_MIN = 440;
export const panelMax = () => (typeof window === "undefined" ? 1100 : Math.max(PANEL_MIN, Math.min(Math.round(window.innerWidth * 0.7), 1100)));
export const clampWidth = (w: number) => Math.round(Math.max(PANEL_MIN, Math.min(panelMax(), w)));

/**
 * Drag handle on the panel's leading edge: a focusable vertical separator (APG window splitter).
 * Drag with pointer capture; ←/→ move the edge 24px (Shift: 96px), Home/End jump to min/max, Enter or a
 * double-click restores the default. It is fixed to the edge, so it never scrolls with the panel.
 */
export function ResizeHandle({ width, onChange }: { width: number; onChange: (w: number) => void }) {
  // While dragging, the width is written straight to the panel and the handle (one style write per frame),
  // so the page doesn't re-render on every pointermove; React gets the final width on release.
  const drag = useRef<{ x: number; w: number; last: number; raf: number; panel: HTMLElement | null } | null>(null);
  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    cancelAnimationFrame(d.raf);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    document.documentElement.removeAttribute("data-panel-resizing");
    if (d.last !== width) onChange(d.last);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuenow={width}
      aria-valuemin={PANEL_MIN}
      aria-valuemax={panelMax()}
      aria-valuetext={`${width} pixels wide`}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, w: width, last: width, raf: 0, panel: e.currentTarget.closest<HTMLElement>('[role="dialog"]') };
        // Turns off text selection and transitions page-wide while dragging (rule in home.tsx).
        document.documentElement.setAttribute("data-panel-resizing", "");
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const w = clampWidth(d.w + (d.x - e.clientX));
        if (w === d.last) return;
        d.last = w;
        const handle = e.currentTarget;
        cancelAnimationFrame(d.raf);
        d.raf = requestAnimationFrame(() => {
          if (d.panel) d.panel.style.width = `${w}px`;
          handle.style.right = `${w - 6}px`;
          handle.setAttribute("aria-valuenow", String(w));
        });
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => onChange(clampWidth(PANEL_DEFAULT))}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 96 : 24;
        // The handle is the panel's left edge: ← moves it left (wider), → moves it right (narrower).
        const next =
          e.key === "ArrowLeft"
            ? width + step
            : e.key === "ArrowRight"
              ? width - step
              : e.key === "Home"
                ? PANEL_MIN
                : e.key === "End"
                  ? panelMax()
                  : e.key === "Enter"
                    ? PANEL_DEFAULT
                    : null;
        if (next == null) return;
        e.preventDefault();
        onChange(clampWidth(next));
      }}
      className="group/resize fixed inset-y-0 z-20 flex w-3 cursor-col-resize touch-none items-center justify-center outline-none"
      style={{ right: width - 6 }}
    >
      <span
        aria-hidden
        className="h-10 w-1 rounded-full bg-line-hover opacity-0 transition-[opacity,background-color,height] duration-150 group-hover/resize:opacity-100 group-focus-visible/resize:h-14 group-focus-visible/resize:bg-ink group-focus-visible/resize:opacity-100 group-active/resize:bg-ink group-active/resize:opacity-100"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function Section({ id, title, aside, sub, children, className }: { id: string; title: string; aside?: ReactNode; sub?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cx("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id={id} className="label text-muted">
            {title}
          </h3>
          {aside}
        </div>
        {sub && <p className="max-w-[640px] text-xs leading-[17px] text-pretty text-subtle">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl bg-surface px-3.5 py-3">
      <div className="text-xs leading-4 text-subtle">{label}</div>
      <div className="text-xl font-semibold leading-7 tracking-[-0.01em] tabular-nums text-ink">{value}</div>
      {sub && <div className="text-[11px] leading-[15px] text-pretty text-muted">{sub}</div>}
    </div>
  );
}

const dash = <span className="text-muted">—</span>;

/** Percentage, or a dash when the base is under the small-sample threshold. */
function Pct({ num, den, smallN }: { num: number; den: number; smallN: number }) {
  const v = rate(num, den, smallN);
  return v == null ? dash : <>{v}%</>;
}

function MiniBar({ pct, tone = "bg-ink", w = "w-16" }: { pct: number; tone?: string; w?: string }) {
  return (
    <span aria-hidden className={cx("relative block h-1 shrink-0 overflow-hidden rounded-full bg-line", w)}>
      <span className={cx("absolute inset-y-0 left-0 rounded-full", tone)} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </span>
  );
}

function Rows({ items }: { items: { k: ReactNode; v: ReactNode; bar?: number }[] }) {
  return (
    <dl className="flex flex-col border-t border-line text-[13px]">
      {items.map((it, i) => (
        <div key={i} className="flex items-center justify-between gap-4 border-b border-line py-2">
          <dt className="min-w-0 truncate text-text">{it.k}</dt>
          <dd className="flex shrink-0 items-center gap-2.5 font-mono text-[12px] tabular-nums text-ink">
            {it.bar != null && <MiniBar pct={it.bar} />}
            {it.v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Tag({ tone = "muted", children, title }: { tone?: "red" | "muted" | "outline"; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex h-[18px] shrink-0 items-center whitespace-nowrap rounded-full px-1.5 font-mono text-[10px] uppercase leading-3 tracking-[0.04em]",
        tone === "red" && "bg-red-soft text-red-deep",
        tone === "muted" && "bg-surface text-subtle",
        tone === "outline" && "border border-line text-subtle",
      )}
    >
      {children}
    </span>
  );
}

/** A target under this share of known jobs is flagged "few alumni here"; a non-target landing at or over COMMON_SHARE is flagged "not a target". */
const RARE_SHARE = 0.05;
const COMMON_SHARE = 0.1;

/* ------------------------------------------------------------------ careers */

function CareerRow({ c, primary, selected, known, smallN, onSelect }: { c: Career; primary: boolean; selected: boolean; known: number; smallN: number; onSelect: () => void }) {
  const rare = c.target && known >= smallN && c.alumni < Math.max(2, Math.ceil(known * RARE_SHARE));
  const first = c.trend[0];
  return (
    <li className="min-w-0">
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cx(
          "flex h-full w-full flex-col gap-3 rounded-2xl border px-4 py-3.5 text-left transition-[border-color,background-color] duration-150",
          selected ? "border-ink bg-white" : "border-line bg-white hover:border-line-hover hover:bg-row-hover",
        )}
      >
        <span className="flex items-start justify-between gap-3">
          <span className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[17px] font-semibold leading-[22px] tracking-[-0.01em] text-balance text-ink">{c.name}</span>
            <span className="flex flex-wrap items-center gap-1.5">
              {primary && (
                <Tag tone="red" title="Highest alignment. The programs table and a Program review use this occupation.">
                  Primary
                </Tag>
              )}
              {c.target ? (
                <Tag>Target</Tag>
              ) : (
                <Tag tone="outline" title="Aligned in the labor-market data but not listed as a program target">
                  Aligned only
                </Tag>
              )}
              {rare && (
                <Tag tone="red" title={`Fewer than ${Math.round(RARE_SHARE * 100)}% of alumni with a known job work in this occupation`}>
                  Few alumni here
                </Tag>
              )}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-0.5">
            <span className="text-[22px] font-semibold leading-7 tracking-[-0.02em] tabular-nums text-ink">{c.score == null ? dash : `${c.score}%`}</span>
            <span className="text-[11px] leading-[14px] text-muted">alignment</span>
          </span>
        </span>
        <span className="grid grid-cols-3 gap-3 text-xs leading-4">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-muted">Postings, 2024</span>
            <span className="font-mono text-[13px] tabular-nums text-ink">
              {fmtNum(c.postings)}{" "}
              {c.growth != null && (
                <span className="text-[11px] text-subtle">
                  <span aria-hidden>{c.growth > 0 ? "↑" : c.growth < 0 ? "↓" : ""}</span>
                  {fmtGrowth(c.growth)}
                  <span className="sr-only"> from 2023</span>
                </span>
              )}
            </span>
            {first && c.trend.length > 1 && (
              <span className="truncate text-[11px] text-muted" title={c.trend.map((t) => `${t.period.slice(0, 4)}: ${t.postings}`).join(", ")}>
                {fmtNum(first.postings)} in {first.period.slice(0, 4)}
              </span>
            )}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-muted">Advertised pay</span>
            <span className="font-mono text-[13px] tabular-nums text-ink">{c.salary == null ? "—" : fmtMoney(c.salary)}</span>
            <span className="text-[11px] text-muted">median, USD per year</span>
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-muted">Alumni in it now</span>
            <span className="font-mono text-[13px] tabular-nums text-ink">
              {c.alumni}
              {known > 0 && <span className="text-[11px] text-subtle"> of {known}</span>}
            </span>
            <span className="text-[11px] text-muted">
              {known >= smallN ? `${Math.round((100 * c.alumni) / known)}% of known jobs` : known ? `n = ${known} · small sample` : "No known jobs"}
            </span>
          </span>
        </span>
        {c.employers.length > 0 && (
          <span className="truncate text-xs text-subtle" title={c.employers.map((e) => `${e.name} (${e.n})`).join(", ")}>
            <span className="text-muted">Alumni employers: </span>
            {c.employers.map((e) => `${e.name} (${e.n})`).join(" · ")}
          </span>
        )}
      </button>
    </li>
  );
}

function Landings({ d, targets, known, smallN }: { d: ProgramDetail; targets: Set<string>; known: number; smallN: number }) {
  if (!d.landings.length) return <p className="text-[13px] text-subtle">No alumni jobs on record.</p>;
  const max = d.landings[0].n;
  return (
    <ul className="flex flex-col border-t border-line">
      {d.landings.map((l) => {
        const isTarget = !!l.code && targets.has(l.code);
        const common = !isTarget && known >= smallN && l.n >= known * COMMON_SHARE;
        return (
          <li key={`${l.code}-${l.name}`} className="flex items-center justify-between gap-3 border-b border-line py-2 text-[13px]">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-text" title={l.name}>
                {l.name}
              </span>
              {isTarget && <Tag>Target</Tag>}
              {common && (
                <Tag tone="red" title={`At least ${Math.round(COMMON_SHARE * 100)}% of alumni with a known job, and not a program target`}>
                  Not a target
                </Tag>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-2.5 font-mono text-[12px] tabular-nums text-ink">
              <MiniBar pct={(100 * l.n) / max} tone={isTarget ? "bg-ink" : "bg-muted"} />
              <span className="w-7 text-right">{l.n}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------------- panel */

export function ProgramPanel({
  row,
  detail,
  loading,
  smallN,
  regionName,
  selectedOcc,
  onSelectOcc,
  onClose,
}: {
  row: ProgramRow;
  detail: ProgramDetail | null;
  loading: boolean;
  smallN: number;
  regionName: string;
  selectedOcc: string | null;
  onSelectOcc: (code: string | null) => void;
  onClose: () => void;
}) {
  const d = detail;
  const outcomesKnown = d ? d.outcomes.inField + d.outcomes.outField : row.inFieldKnown;
  const primary = d?.careers[0] ?? null;
  const career = (d && d.careers.find((c) => c.code === selectedOcc)) ?? primary;
  const targets = new Set(d?.careers.filter((c) => c.target).map((c) => c.code) ?? []);
  const known = row.known;
  return (
    <>
      <PanelHeader id="program-title" eyebrow={`${levelLabel(row.level)} · ${row.familyLabel} · CIP ${row.cip}`} title={row.name} onClose={onClose} closeLabel="Close program details">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
            <span>{plural(row.alumni, "alumni record", "alumni records")}</span>
            {d && <span>{plural(d.courses, "course", "courses")}</span>}
            {row.quality !== "ok" && <SmallN n={row.known} min={smallN} />}
          </div>
          <NextStep row={row} size="md" />
        </div>
      </PanelHeader>

      <div aria-busy={loading || undefined} className={cx("@container flex flex-col gap-9 px-7 py-6 transition-opacity duration-150", loading && !d && "opacity-60")}>
        {!d ? (
          <p role="status" className="text-[13px] text-subtle">
            {loading ? "Loading program details…" : "Details aren’t available for this program."}
          </p>
        ) : (
          <>
            <Section
              id="pp-careers"
              title="Careers this program leads to"
              aside={<span className="text-[11px] text-muted">ranked by alignment</span>}
              sub={
                <>
                  Target occupations, plus occupations the labor-market data aligns with the program. Alignment is for King County, 2024; postings and pay for {regionName}; alumni counts are
                  current jobs. Select one to see its skills gap.
                </>
              }
            >
              {d.careers.length === 0 ? (
                <p className="text-[13px] text-subtle">No target or aligned occupations on record.</p>
              ) : (
                <ul className="grid grid-cols-1 gap-2.5 @3xl:grid-cols-2">
                  {d.careers.map((c, i) => (
                    <CareerRow
                      key={c.code}
                      c={c}
                      primary={i === 0}
                      selected={career?.code === c.code}
                      known={known}
                      smallN={smallN}
                      onSelect={() => onSelectOcc(i === 0 ? null : c.code)}
                    />
                  ))}
                </ul>
              )}
            </Section>

            <div className="grid grid-cols-1 gap-9 @3xl:grid-cols-2 @3xl:gap-x-8">
              {row.alumni > 0 && (
                <Section
                  id="pp-landings"
                  title="Where alumni actually land"
                  aside={<SmallN n={known} min={smallN} />}
                  sub={`Current occupations of the ${plural(known, "graduate", "graduates")} with a known job, most common first.`}
                >
                  <Landings d={d} targets={targets} known={known} smallN={smallN} />
                </Section>
              )}

              {career && (
                <Section id="pp-coverage" title={`Skills gap for ${career.name}`} aside={<span className="text-[11px] text-muted">King County · 2024</span>}>
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label="Alignment" value={career.score == null ? dash : `${career.score}%`} sub="Skill coverage score for this occupation" />
                    <Stat label="Benchmark skills taught" value={career.bench.total ? `${career.bench.taught} of ${career.bench.total}` : dash} sub="Skills employers name most for it" />
                  </div>
                  {career.bench.gaps.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      <div className="text-[13px] font-medium text-ink">Most-requested skills the curriculum doesn’t teach</div>
                      <ul className="flex flex-wrap gap-1.5">
                        {career.bench.gaps.map((g) => (
                          <li key={g.id} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line px-2.5 text-xs text-ink" title={`Named in ${g.postings} postings`}>
                            {g.name}
                            <span className="font-mono text-[11px] tabular-nums text-muted">{fmtNum(g.postings)}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="text-[11px] leading-[15px] text-muted">Number = King County postings that name the skill, 2024.</p>
                    </div>
                  ) : (
                    career.bench.total > 0 && <p className="text-[13px] text-subtle">The curriculum teaches every benchmark skill for this occupation.</p>
                  )}
                </Section>
              )}

              <Section id="pp-outcomes" title="Alumni outcomes" aside={<SmallN n={outcomesKnown} min={smallN} />}>
                {row.alumni === 0 ? (
                  <p className="text-[13px] text-subtle">No alumni records are linked to this program, so there are no outcomes to report.</p>
                ) : (
                  <>
                    <OutcomeBar inField={d.outcomes.inField} outField={d.outcomes.outField} unknown={d.outcomes.unknown} />
                    <Rows
                      items={[
                        { k: "Working in field", v: `${d.outcomes.inField}` },
                        { k: "Working out of field", v: `${d.outcomes.outField}` },
                        { k: "No job on record", v: `${d.outcomes.unknown}` },
                        {
                          k: "In field, of known jobs",
                          v: (
                            <>
                              <Pct num={d.outcomes.inField} den={outcomesKnown} smallN={smallN} />{" "}
                              <span className="text-muted">
                                ({d.outcomes.inField}/{outcomesKnown})
                              </span>
                            </>
                          ),
                        },
                        {
                          k: "Live in the service region",
                          v: (
                            <>
                              <Pct num={d.outcomes.region} den={d.outcomes.regionKnown} smallN={smallN} />{" "}
                              <span className="text-muted">
                                ({d.outcomes.region}/{d.outcomes.regionKnown})
                              </span>
                            </>
                          ),
                        },
                      ]}
                    />
                  </>
                )}
              </Section>

              {row.alumni > 0 && (
                <Section id="pp-ttj" title="Time to first job" aside={<SmallN n={d.ttj.n} min={smallN} />}>
                  {d.ttj.n === 0 ? (
                    <p className="text-[13px] text-subtle">No first-job dates on record.</p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <Stat label="Hired within 6 months" value={<Pct num={d.ttj.within6} den={d.ttj.n} smallN={smallN} />} sub={`${d.ttj.within6} of ${d.ttj.n} with a first-job date`} />
                        <Stat
                          label="Median months"
                          value={d.ttj.n >= smallN && d.ttj.median != null ? d.ttj.median.toLocaleString("en-US", { maximumFractionDigits: 1 }) : dash}
                          sub="From June of the graduation year"
                        />
                      </div>
                      <Rows
                        items={[
                          { k: "0–6 months", v: d.ttj.within6, bar: (100 * d.ttj.within6) / d.ttj.n },
                          { k: "7–12 months", v: d.ttj.within12, bar: (100 * d.ttj.within12) / d.ttj.n },
                          { k: "More than 12 months", v: d.ttj.over12, bar: (100 * d.ttj.over12) / d.ttj.n },
                        ]}
                      />
                    </>
                  )}
                </Section>
              )}

              {row.alumni > 0 && (
                <Section id="pp-wage" title="Salary on the current job" aside={<SmallN n={d.wage.n} min={smallN} />}>
                  {d.wage.n === 0 ? (
                    <p className="text-[13px] text-subtle">No annual salaries on record.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <Stat label="Median" value={d.wage.n >= smallN ? fmtMoney(d.wage.median) : dash} sub={plural(d.wage.n, "annual salary", "annual salaries")} />
                      <Stat
                        label="Middle half"
                        value={d.wage.n >= smallN ? <span className="text-base">{`${fmtMoney(d.wage.p25)}–${fmtMoney(d.wage.p75)}`}</span> : dash}
                        sub={d.wage.hourly ? `${plural(d.wage.hourly, "hourly wage", "hourly wages")} not included` : "25th to 75th percentile"}
                      />
                    </div>
                  )}
                </Section>
              )}

              {d.employers.length > 0 && (
                <Section id="pp-employers" title="Top employers" aside={<span className="text-[11px] text-muted">alumni on record</span>}>
                  <Rows items={d.employers.map((e) => ({ k: e.name, v: e.n }))} />
                </Section>
              )}
            </div>

            <Section id="pp-activities" title="Activities" aside={d.activities.length > 0 && <span className="text-[11px] text-muted">newest first</span>}>
              {d.activities.length === 0 ? (
                <p className="text-[13px] text-subtle">No activities yet. Create a program review or an outcomes story, or send a survey, to start one.</p>
              ) : (
                <ul className="flex flex-col border-t border-line">
                  {d.activities.map((a) => (
                    <li key={a.id} className="border-b border-line">
                      <Link to={a.path} className="flex items-center justify-between gap-4 rounded-sm py-2.5 transition-colors duration-150 hover:bg-row-hover">
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                            <KindIcon kind={a.kind} className="text-subtle" />
                            {a.kindLabel}
                          </span>
                          <span className="text-[11px] text-muted">
                            Opened {fmtDate(a.openedAt)}
                            {a.closedAt ? ` · closed ${fmtDate(a.closedAt)}` : ` · updated ${fmtDate(a.updatedAt)}`}
                          </span>
                        </span>
                        <span className="text-xs">
                          <StatusLabel status={a.status} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </>
        )}
      </div>
    </>
  );
}

/** In field / out of field / unknown as one stacked bar. Counts sit in the list below, so the bar is decorative. */
function OutcomeBar({ inField, outField, unknown }: { inField: number; outField: number; unknown: number }) {
  const total = inField + outField + unknown;
  if (!total) return null;
  const seg = [
    { n: inField, cls: "bg-ink", label: "In field" },
    { n: outField, cls: "bg-muted", label: "Out of field" },
    { n: unknown, cls: "hatch", label: "No job on record" },
  ];
  return (
    <div className="flex flex-col gap-2">
      <div aria-hidden className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full">
        {seg.map((s) => (s.n ? <span key={s.label} className={s.cls} style={{ flexGrow: s.n, flexBasis: 0 }} /> : null))}
      </div>
      <div aria-hidden className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-subtle">
        {seg.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className={cx("h-2 w-2 rounded-full", s.cls)} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
