import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { StatusLabel } from "~/components/activities";
import { cx, ease, useFirstPaint } from "~/components/ui";
import { KindIcon, NextStep } from "./actions";
import { COLUMNS, defaultDir, fmtGrowth, fmtK, fmtNum, levelLabel, median, plural, rate, type ColumnKey, type ProgramRow, type SortKey, type TableState } from "./model";

/* ------------------------------------------------------------------ cells */

/** A missing value: a dash for the eye, the reason for screen readers and on hover. */
function NA({ why }: { why: string }) {
  return (
    <span title={why} className="cursor-help text-muted">
      <span aria-hidden>—</span>
      <span className="sr-only">{why}</span>
    </span>
  );
}

/** Inline share bar: no axis, no labels, just the proportion beside the number. */
function Bar({ pct }: { pct: number }) {
  return (
    <span aria-hidden className="relative block h-1 w-9 shrink-0 overflow-hidden rounded-full bg-line">
      <span className="absolute inset-y-0 left-0 rounded-full bg-ink" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </span>
  );
}

const num = "font-mono text-[13px] tabular-nums text-ink";

/** `what` is [singular, plural], e.g. ["annual salary", "annual salaries"]. */
function tooFew(n: number, smallN: number, [one, many]: [string, string]) {
  return n === 0 ? `No ${many} on record` : `Too few records to report a rate: ${plural(n, one, many)} (fewer than ${smallN})`;
}
const KNOWN_JOB: [string, string] = ["alumnus with a known job", "alumni with a known job"];
const JOB_DATE: [string, string] = ["alumnus with a first-job date", "alumni with a first-job date"];

function Cell({ col, r, smallN }: { col: ColumnKey; r: ProgramRow; smallN: number }) {
  switch (col) {
    case "activity": {
      if (!r.live) return <NA why="No open activity" />;
      const more = r.liveAll.length - 1;
      return (
        <span className="flex min-w-0 flex-col gap-0.5 text-xs leading-4" title={r.liveAll.map((a) => `${a.kindLabel}: ${a.status.label}`).join("\n")}>
          <StatusLabel status={r.live.status} />
          <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted">
            <KindIcon kind={r.live.kind} />
            <span className="truncate">{r.live.kindLabel}</span>
            {more > 0 && <span className="shrink-0 font-mono tabular-nums">+{more}<span className="sr-only"> more open</span></span>}
          </span>
        </span>
      );
    }
    case "coverage":
      if (r.coverage == null) return <NA why="No alignment score" />;
      return (
        <span className="flex items-center gap-2" title={r.occupation ? `Alignment with ${r.occupation.name}, King County, 2024` : undefined}>
          <span className={cx(num, "w-8 text-right")}>{r.coverage}%</span>
          <Bar pct={r.coverage} />
        </span>
      );
    case "occupation":
      if (!r.occupation) return <NA why="No aligned occupation" />;
      return (
        <span className="block truncate text-[13px] text-text" title={r.occupations.join(" · ")}>
          {r.occupation.name}
        </span>
      );
    case "alumni":
      return r.alumni ? <span className={num}>{fmtNum(r.alumni)}</span> : <NA why="No alumni records linked to this program" />;
    case "inField": {
      const v = rate(r.inField, r.inFieldKnown, smallN);
      if (v == null) return <NA why={tooFew(r.inFieldKnown, smallN, KNOWN_JOB)} />;
      return (
        <span className="flex items-center gap-2" title={`${r.inField} of ${r.inFieldKnown} alumni with a known job`}>
          <span className={cx(num, "w-8 text-right")}>{v}%</span>
          <Bar pct={v} />
        </span>
      );
    }
    case "hired6": {
      const v = rate(r.within6, r.ttjN, smallN);
      if (v == null) return <NA why={tooFew(r.ttjN, smallN, JOB_DATE)} />;
      return (
        <span className={num} title={`${r.within6} of ${r.ttjN} alumni with a first-job date`}>
          {v}%
        </span>
      );
    }
    case "months":
      if (r.ttjN < smallN || r.medianMonths == null) return <NA why={tooFew(r.ttjN, smallN, JOB_DATE)} />;
      return (
        <span className={num} title={`Median of ${r.ttjN} alumni`}>
          {r.medianMonths.toLocaleString("en-US", { maximumFractionDigits: 1 })}
        </span>
      );
    case "wage":
      if (r.wageN < smallN || r.medianWage == null)
        return <NA why={`${tooFew(r.wageN, smallN, ["annual salary", "annual salaries"])}${r.hourlyN ? `. ${plural(r.hourlyN, "hourly wage", "hourly wages")} not annualized` : ""}`} />;
      return (
        <span className={num} title={`Median of ${r.wageN} annual salaries`}>
          {fmtK(r.medianWage)}
        </span>
      );
    case "unknown":
      if (!r.alumni) return <NA why="No alumni records linked to this program" />;
      return (
        <span className={cx(num, r.unknown === 0 && "text-muted")} title={`${r.unknown} of ${r.alumni} alumni have no job on record`}>
          {fmtNum(r.unknown)}
        </span>
      );
    case "demand":
      if (r.postings == null) return <NA why="No posting data for this occupation and region" />;
      return (
        <span className="flex flex-col items-end gap-0.5 leading-4">
          <span className={num}>{fmtNum(r.postings)}</span>
          {r.growth != null && (
            <span className="font-mono text-[11px] tabular-nums text-muted">
              <span aria-hidden>{r.growth > 0 ? "↑" : r.growth < 0 ? "↓" : ""}</span>
              {fmtGrowth(r.growth)}
              <span className="sr-only"> from 2023</span>
            </span>
          )}
        </span>
      );
    case "quality":
      return <QualityTag q={r.quality} n={r.known} smallN={smallN} quiet={false} />;
    case "next":
      return <NextStep row={r} />;
  }
}

function QualityTag({ q, n, smallN, quiet }: { q: ProgramRow["quality"]; n: number; smallN: number; quiet: boolean }) {
  if (q === "ok") return quiet ? null : <span className="text-xs text-subtle">Enough records</span>;
  const text = q === "none" ? "No alumni" : `n = ${n}`;
  return (
    <span
      className="inline-flex h-[18px] items-center whitespace-nowrap rounded-full bg-red-soft px-1.5 font-mono text-[10px] uppercase tracking-[0.04em] text-red-deep"
      title={q === "none" ? "No alumni records linked to this program" : `Only ${n} alumni with a known job (fewer than ${smallN}). Rates are hidden.`}
    >
      {text}
      <span className="sr-only">{q === "none" ? "" : ", small sample"}</span>
    </span>
  );
}

/* --------------------------------------------------------------- subtotals */

function Subtotal({ col, rows, smallN }: { col: ColumnKey; rows: ProgramRow[]; smallN: number }) {
  const sum = (f: (r: ProgramRow) => number) => rows.reduce((t, r) => t + f(r), 0);
  const sub = "font-mono text-[12px] tabular-nums text-subtle";
  switch (col) {
    case "activity": {
      const live = rows.filter((r) => r.live).length;
      return live ? <span className="text-xs text-subtle">{live} open</span> : null;
    }
    case "coverage": {
      const m = median(rows.flatMap((r) => (r.coverage == null ? [] : [r.coverage])));
      return m == null ? null : (
        <span className={sub} title="Median coverage in this group">
          med {Math.round(m)}%
        </span>
      );
    }
    case "alumni":
      return <span className={sub}>{fmtNum(sum((r) => r.alumni))}</span>;
    case "inField": {
      const v = rate(
        sum((r) => r.inField),
        sum((r) => r.inFieldKnown),
        smallN,
      );
      return v == null ? null : (
        <span className={sub} title={`${sum((r) => r.inField)} of ${sum((r) => r.inFieldKnown)} alumni with a known job, pooled`}>
          {v}%
        </span>
      );
    }
    case "hired6": {
      const v = rate(
        sum((r) => r.within6),
        sum((r) => r.ttjN),
        smallN,
      );
      return v == null ? null : <span className={sub}>{v}%</span>;
    }
    case "unknown":
      return <span className={sub}>{fmtNum(sum((r) => r.unknown))}</span>;
    case "quality": {
      const n = rows.filter((r) => r.quality !== "ok").length;
      return n ? <span className="text-xs text-subtle">{n} flagged</span> : null;
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ table */

export type Group = { key: string; label: string; rows: ProgramRow[] };

function SortGlyph({ dir }: { dir: "asc" | "desc" | null }) {
  return (
    <svg width="8" height="10" viewBox="0 0 8 10" aria-hidden className="shrink-0">
      <path d="M4 1L7 4H1z" fill="currentColor" opacity={dir === "asc" ? 1 : 0.25} />
      <path d="M4 9L1 6h6z" fill="currentColor" opacity={dir === "desc" ? 1 : 0.25} />
    </svg>
  );
}

const thBase = "sticky top-0 z-10 h-10 border-b border-line bg-white/95 px-2 align-middle font-normal backdrop-blur-sm";

export function ProgramsTable({
  groups,
  grouped,
  state,
  cols,
  smallN,
  selected,
  hrefFor,
  onSort,
  total,
  emptyAction,
}: {
  groups: Group[];
  grouped: boolean;
  state: TableState;
  cols: ColumnKey[];
  smallN: number;
  selected: string | null;
  hrefFor: (id: string) => string;
  onSort: (key: SortKey, dir: "asc" | "desc") => void;
  total: number;
  emptyAction: ReactNode;
}) {
  const navigate = useNavigate();
  const firstPaint = useFirstPaint();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // Rows mounted with the table stagger in once (after a client navigation; the server HTML is already final).
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  const columns = COLUMNS.filter((c) => cols.includes(c.key));
  const shown = groups.reduce((t, g) => t + g.rows.length, 0);
  // Re-measure row positions only when the order or membership changes (not on hover, selection or typing).
  const orderKey = groups.map((g) => g.key + (collapsed.has(g.key) ? "-" : ":") + g.rows.map((r) => r.id).join(",")).join("|");

  const sortHeader = (label: ReactNode, key: SortKey, align?: "right", help?: string) => {
    const on = state.sort === key;
    const next = on ? (state.dir === "asc" ? "desc" : "asc") : defaultDir(key);
    return (
      <button
        type="button"
        onClick={() => onSort(key, next)}
        title={help}
        className={cx(
          "label -mx-1 inline-flex items-center gap-1 rounded px-1 py-1 whitespace-pre-line transition-colors duration-150 hover:text-ink",
          on ? "text-ink" : "text-muted",
          align === "right" && "text-right",
        )}
      >
        <span>{label}</span>
        <SortGlyph dir={on ? state.dir : null} />
        <span className="sr-only">{on ? `, sorted ${state.dir === "asc" ? "ascending" : "descending"}` : ", sortable"}</span>
      </button>
    );
  };
  const ariaSort = (key?: SortKey) => (key && state.sort === key ? (state.dir === "asc" ? "ascending" : "descending") : undefined);

  let index = 0;
  return (
    <table className="w-full min-w-[1080px] table-fixed border-separate border-spacing-0 text-left">
      <caption className="sr-only">
        {plural(shown, "program", "programs")} of {total}. Select a program name to open its details.
      </caption>
      <colgroup>
        <col />
        {columns.map((c) => (
          <col key={c.key} className={c.width} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th scope="col" aria-sort={ariaSort("name")} className={cx(thBase, "pl-0 text-left")}>
            {sortHeader("Program", "name")}
          </th>
          {columns.map((c) => (
            <th key={c.key} scope="col" aria-sort={ariaSort(c.sort)} className={cx(thBase, c.align === "right" ? "text-right" : "text-left", c.key === "next" && "pr-0")}>
              {c.sort ? sortHeader(c.head ?? c.label, c.sort, c.align, c.help) : <span className="label text-muted">{c.label}</span>}
            </th>
          ))}
        </tr>
      </thead>
      {shown === 0 && (
        <tbody>
          <tr>
            <td colSpan={columns.length + 1} className="py-12">
              <div className="flex flex-col items-start gap-3">
                <div className="text-base font-semibold text-ink">No programs match</div>
                <p className="text-[13px] leading-[19px] text-subtle">Try a shorter search, or clear the filters.</p>
                {emptyAction}
              </div>
            </td>
          </tr>
        </tbody>
      )}
      {groups.map((g) => {
        if (!g.rows.length) return null;
        const isCollapsed = grouped && collapsed.has(g.key);
        const bodyId = `group-${g.key}`;
        return (
          <tbody key={g.key} id={grouped ? bodyId : undefined}>
            {grouped && (
              <tr className="bg-surface">
                <th scope="rowgroup" className="h-10 border-b border-line pl-0 pr-2 text-left font-normal">
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsed((s) => {
                        const n = new Set(s);
                        if (n.has(g.key)) n.delete(g.key);
                        else n.add(g.key);
                        return n;
                      })
                    }
                    className="flex w-full items-center gap-2 rounded-md py-1.5 pl-2 text-left transition-colors duration-150 hover:text-ink"
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 10 10"
                      aria-hidden
                      className={cx("shrink-0 text-subtle transition-[rotate] duration-200 ease-out", !isCollapsed && "rotate-90")}
                    >
                      <path d="M3.5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="truncate text-[13px] font-semibold text-ink">{g.label}</span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">{plural(g.rows.length, "program", "programs")}</span>
                  </button>
                </th>
                {columns.map((c) => (
                  <td key={c.key} className={cx("h-10 border-b border-line px-2", c.align === "right" && "text-right")}>
                    <Subtotal col={c.key} rows={g.rows} smallN={smallN} />
                  </td>
                ))}
              </tr>
            )}
            {!isCollapsed &&
              g.rows.map((r) => {
                const i = index++;
                const on = r.id === selected;
                const href = hrefFor(r.id);
                return (
                  <motion.tr
                    key={r.id}
                    layout="position"
                    layoutDependency={orderKey}
                    initial={firstPaint ? false : { opacity: 0, y: mounted.current ? 0 : 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      opacity: {
                        duration: mounted.current ? 0.15 : 0.3,
                        ease: "easeOut",
                        delay: mounted.current ? 0 : Math.min(i, 16) * 0.025,
                      },
                      y: {
                        duration: 0.3,
                        ease,
                        delay: Math.min(i, 16) * 0.025,
                      },
                      layout: { type: "spring", duration: 0.35, bounce: 0 },
                    }}
                    onClick={(e) => {
                      const t = e.target as HTMLElement;
                      if (t.closest("a,button,input,select,textarea,label,[role=menu]")) return;
                      if (window.getSelection()?.toString()) return;
                      navigate(href, { preventScrollReset: true });
                    }}
                    className={cx("group/row cursor-pointer transition-colors duration-150", on ? "bg-surface" : "hover:bg-row-hover")}
                  >
                    <th scope="row" className="h-14 border-b border-line py-2 pl-0 pr-3 text-left font-normal">
                      <Link to={href} preventScrollReset data-row-link={r.id} aria-current={on ? "true" : undefined} className="flex min-w-0 flex-col gap-0.5 rounded-sm">
                        <span
                          className="truncate text-sm font-medium leading-5 text-ink group-hover/row:underline group-hover/row:decoration-line-hover group-hover/row:underline-offset-[3px]"
                          title={r.name}
                        >
                          {r.name}
                        </span>
                        <span className="flex min-w-0 items-center gap-1.5 text-xs leading-4 text-muted">
                          <span className="truncate">
                            {levelLabel(r.level)} · {r.familyLabel}
                          </span>
                          {!cols.includes("quality") && <QualityTag q={r.quality} n={r.known} smallN={smallN} quiet />}
                        </span>
                      </Link>
                    </th>
                    {columns.map((c) => (
                      <td key={c.key} className={cx("h-14 border-b border-line px-2 py-2 align-middle", c.align === "right" && "text-right", c.key === "next" && "pr-0")}>
                        {c.align === "right" ? (
                          <span className="flex justify-end">
                            <Cell col={c.key} r={r} smallN={smallN} />
                          </span>
                        ) : (
                          <Cell col={c.key} r={r} smallN={smallN} />
                        )}
                      </td>
                    ))}
                  </motion.tr>
                );
              })}
          </tbody>
        );
      })}
    </table>
  );
}

/* ---------------------------------------------------------------- toolbar */

/** Toggle chip: a real button with aria-pressed, so its on/off state is announced. */
export function Chip({ on, onClick, children, count }: { on: boolean; onClick: () => void; children: ReactNode; count?: number }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs transition-[background-color,border-color,color,scale] duration-150 ease-out active:scale-[0.96]",
        on ? "border-ink bg-ink font-medium text-white" : "border-line bg-white text-subtle hover:border-ink hover:text-ink",
        !on && count === 0 && "text-muted",
      )}
    >
      {children}
      {count != null && <span className={cx("font-mono text-[11px] tabular-nums", on ? "text-white/70" : "text-muted")}>{count}</span>}
    </button>
  );
}

export function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex flex-wrap items-center gap-1.5">
      <span id={id} className="label mr-1 text-muted">
        {label}
      </span>
      {children}
    </div>
  );
}

/** Search box. "/" or ⌘K / Ctrl+K focuses it from anywhere on the page; Esc clears it. */
export function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t?.closest("input,textarea,select,[contenteditable=true]");
      const slash = e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !typing;
      const cmdK = e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
      if (!slash && !cmdK) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div
      role="search"
      className="flex h-9 w-[340px] max-w-full items-center gap-2 rounded-full border border-control pl-3.5 pr-1.5 transition-colors duration-150 focus-within:border-ink hover:border-ink"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden className="shrink-0 text-subtle">
        <circle cx="6" cy="6" r="4.25" stroke="currentColor" strokeWidth="1.5" />
        <path d="M9.25 9.25L12.5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <label htmlFor={id} className="sr-only">
        Search programs
      </label>
      <input
        ref={input}
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            onChange("");
          }
        }}
        aria-keyshortcuts="/ Meta+K Control+K"
        autoComplete="off"
        spellCheck={false}
        placeholder="Search programs, CIP codes, occupations"
        className="min-w-0 grow bg-transparent text-[13px] text-ink outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            onChange("");
            input.current?.focus();
          }}
          aria-label="Clear search"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-subtle transition-colors duration-150 hover:bg-surface hover:text-ink"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      ) : (
        <kbd aria-hidden className="shrink-0 rounded-full bg-surface px-2 py-0.5 font-mono text-[11px] text-subtle">
          /
        </kbd>
      )}
    </div>
  );
}

/** Show/hide columns: a disclosure with native checkboxes (stays open while you toggle several). */
export function ColumnsMenu({ cols, onChange }: { cols: ColumnKey[]; onChange: (cols: ColumnKey[]) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const hideable = COLUMNS.filter((c) => c.hideable);
  const shownCount = hideable.filter((c) => cols.includes(c.key)).length;
  return (
    // Closes when focus moves to something outside. A click on a non-focusable label inside blurs with no
    // relatedTarget; that must not close it (outside clicks are handled by the pointerdown listener).
    <div ref={wrap} className="relative" onBlur={(e) => e.relatedTarget && !wrap.current?.contains(e.relatedTarget as Node) && setOpen(false)}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] text-ink transition-[border-color,scale] duration-150 ease-out active:scale-[0.96]",
          open ? "border-ink" : "border-line hover:border-ink",
        )}
      >
        Columns
        <span className="font-mono text-[11px] tabular-nums text-muted">
          {shownCount}/{hideable.length}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{
              opacity: 1,
              scale: 1,
              transition: { type: "spring", duration: 0.25, bounce: 0 },
            }}
            exit={{
              opacity: 0,
              scale: 0.98,
              transition: { duration: 0.12, ease: "easeOut" },
            }}
            className="absolute right-0 top-11 z-30 w-[260px] origin-top-right rounded-xl border border-line bg-white p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.10),0_2px_6px_rgba(0,0,0,0.04)]"
          >
            <fieldset>
              <legend className="label px-2 pb-1.5 pt-1 text-muted">Show columns</legend>
              {hideable.map((c) => {
                const on = cols.includes(c.key);
                return (
                  <label
                    key={c.key}
                    className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-ink transition-colors duration-100 hover:bg-surface has-[:focus-visible]:bg-surface"
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => onChange(on ? cols.filter((k) => k !== c.key) : [...cols, c.key])}
                      className="mt-0.5 accent-ink"
                    />
                    <span className="flex flex-col">
                      <span>{c.label}</span>
                      {c.help && <span className="text-[11px] leading-[15px] text-muted">{c.help}</span>}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
