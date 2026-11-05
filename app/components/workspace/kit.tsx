import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { CountUp, Item, cx, ease } from "~/components/ui";

/* Shared chrome for the workspace dashboards (/surveys, /integrations, /exports, /account). */

export function TopBar({ trail, children }: { trail: string; children?: ReactNode }) {
  return (
    <div className="flex h-16 shrink-0 items-center justify-between gap-6 border-b border-line px-10">
      <div className="font-mono text-xs uppercase tracking-[0.04em] text-muted">North Sound State University / {trail}</div>
      {children}
    </div>
  );
}

/** One KPI. `demo` tiles are simulated: dashed outline and a "demo" tag, kept apart from real numbers. */
export function Kpi({
  label,
  value,
  format,
  sub,
  demo,
  tone,
}: {
  label: string;
  value: number | string;
  format?: (v: number) => string;
  sub?: ReactNode;
  demo?: boolean;
  tone?: "red";
}) {
  return (
    <div className={cx("flex min-w-0 flex-1 basis-0 flex-col gap-1.5 rounded-xl px-4 py-3.5", demo ? "border border-dashed border-muted" : "bg-surface")}>
      <div className="label flex items-center justify-between gap-2 text-muted">
        <span className="truncate">{label}</span>
        {demo && <span className="shrink-0 rounded-full border border-dashed border-muted px-1.5 text-[10px] leading-4 text-subtle">demo</span>}
      </div>
      <div className={cx("text-[26px] font-semibold leading-8 tracking-[-0.02em] tabular-nums", tone === "red" ? "text-red" : "text-ink")}>
        {typeof value === "number" ? <CountUp value={value} format={format ?? ((v) => Math.round(v).toLocaleString("en-US"))} /> : value}
      </div>
      {sub && <div className="text-xs leading-4 text-pretty text-subtle">{sub}</div>}
    </div>
  );
}

export function KpiStrip({ children, label }: { children: ReactNode; label: string }) {
  return (
    <Item as="section" className="flex gap-3">
      <h2 className="sr-only">{label}</h2>
      {children}
    </Item>
  );
}

const PILL: Record<string, string> = {
  red: "bg-red-soft text-red-deep",
  ink: "border border-ink text-ink",
  solid: "bg-ink text-white",
  muted: "bg-surface text-subtle",
  dashed: "border border-dashed border-muted text-subtle",
};
const DOT: Record<string, string> = { red: "bg-red", ink: "bg-ink", solid: "bg-white", muted: "bg-muted", dashed: "bg-muted" };

export function Pill({ tone = "muted", children }: { tone?: keyof typeof PILL; children: ReactNode }) {
  return (
    <span className={cx("inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium", PILL[tone])}>
      <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", DOT[tone])} />
      {children}
    </span>
  );
}

export function DemoTag({ children = "demo" }: { children?: ReactNode }) {
  return <span className="label inline-flex h-[18px] items-center rounded-full border border-dashed border-muted px-1.5 text-[10px] leading-3 text-subtle">{children}</span>;
}

/** "n = 7 · small sample" beside a figure whose base is under the threshold. */
export function SmallN({ n, min }: { n: number; min: number }) {
  if (n >= min) return null;
  return (
    <span className="whitespace-nowrap font-mono text-[11px] text-red" title={`Fewer than ${min} records: read with care`}>
      n = {n} · small sample
    </span>
  );
}

/** Filter segment rendered as links, so filters live in the URL. */
export function Segmented({ label, param, options, value }: { label: string; param: string; options: { value: string; label: string; count?: number }[]; value: string }) {
  const [params] = useSearchParams();
  const href = (v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(param, v);
    else p.delete(param);
    const s = p.toString();
    return s ? `?${s}` : "?";
  };
  return (
    <nav aria-label={label} className="flex items-center gap-1 rounded-full bg-surface p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Link
            key={o.value || "all"}
            to={href(o.value)}
            replace
            preventScrollReset
            aria-current={on ? "true" : undefined}
            className={cx(
              "relative flex h-7 items-center gap-1.5 rounded-full px-3 text-xs transition-colors duration-150",
              on ? "font-medium text-ink" : "text-subtle hover:text-ink",
            )}
          >
            {on && <motion.span layoutId={`seg-${param}`} className="absolute inset-0 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08)]" transition={{ type: "spring", duration: 0.3, bounce: 0 }} />}
            <span className="relative">{o.label}</span>
            {o.count != null && <span className="relative font-mono text-[11px] tabular-nums text-muted">{o.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export function SectionHead({ id, title, sub, children }: { id?: string; title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-6">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-lg font-semibold leading-6 tracking-[-0.01em] text-ink">
          {title}
        </h2>
        {sub && <p className="max-w-[640px] text-[13px] leading-[19px] text-pretty text-subtle">{sub}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease }}
      className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-line-hover px-8 py-10"
    >
      <div className="text-base font-semibold text-ink">{title}</div>
      <div className="max-w-[560px] text-[13px] leading-[19px] text-pretty text-subtle">{children}</div>
      {action && <div className="mt-1 flex flex-wrap items-center gap-2">{action}</div>}
    </motion.div>
  );
}

/** Table header cell. */
export function Th({ children, className, align }: { children?: ReactNode; className?: string; align?: "right" }) {
  return (
    <th scope="col" className={cx("label h-9 border-b border-line px-3 text-left font-normal text-muted first:pl-0 last:pr-0", align === "right" && "text-right", className)}>
      {children}
    </th>
  );
}

/** Row behaviour shared by every workspace table: the first-cell link is the target; the row is a pointer shortcut. */
export function rowClick(href: string, navigate: ReturnType<typeof useNavigate>) {
  return (e: React.MouseEvent<HTMLTableRowElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest("a,button,input,select,textarea,label")) return;
    if (window.getSelection()?.toString()) return;
    navigate(href, { preventScrollReset: true });
  };
}

/** Builds a URL that keeps the current search params and sets/removes some. */
export function useHrefWith() {
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  return (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) p.delete(k);
      else p.set(k, v);
    }
    const s = p.toString();
    return s ? `${pathname}?${s}` : pathname;
  };
}

/** Keeps the last non-null value, so a closing panel can keep rendering what it showed while it slides out. */
export function useLatest<T>(value: T | null | undefined) {
  const last = useRef<T | null>(value ?? null);
  if (value != null) last.current = value;
  return last.current;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Accessible slide-over: role=dialog + aria-modal, focus moves in on open and is trapped, Esc closes,
 * the sidebar and page behind are inert, and focus returns to `returnFocus` (a selector) or the opener.
 * Slides in with a spring (bounce 0); reduced motion keeps only the fade (MotionConfig reducedMotion="user").
 */
export function SlideOver({
  open,
  onClose,
  labelledBy,
  returnFocus,
  width = 520,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  returnFocus?: string | null;
  width?: number;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const returnRef = useRef(returnFocus);
  returnRef.current = returnFocus;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const behind = [document.querySelector("aside"), document.querySelector("[data-ws-page]")].filter(Boolean) as HTMLElement[];
    behind.forEach((el) => el.setAttribute("inert", ""));
    const el = panel.current;
    (el?.querySelector<HTMLElement>("[data-autofocus]") ?? el)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!items.length) {
        e.preventDefault();
        el.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      behind.forEach((n) => n.removeAttribute("inert"));
      const target = (returnRef.current && document.querySelector<HTMLElement>(returnRef.current)) || (opener && opener.isConnected ? opener : null);
      target?.focus({ preventScroll: true });
    };
  }, [open]);

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div key="backdrop" className="fixed inset-0 z-40 bg-ink/10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: "easeOut" }} onClick={onClose} aria-hidden />
      )}
      {open && (
        <motion.div
          key="panel"
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          tabIndex={-1}
          className="fixed inset-y-0 right-0 z-50 flex max-w-full flex-col overflow-y-auto overscroll-contain border-l border-line bg-white shadow-[-24px_0_48px_rgba(0,0,0,0.08)] focus:outline-none"
          style={{ width }}
          initial={{ x: "100%", opacity: 0.6 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "100%", opacity: 0.6, transition: { type: "spring", duration: 0.3, bounce: 0 } }}
          transition={{ type: "spring", duration: 0.45, bounce: 0 }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function PanelHeader({ id, eyebrow, title, onClose, closeLabel = "Close panel", children }: { id: string; eyebrow: ReactNode; title: ReactNode; onClose: () => void; closeLabel?: string; children?: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex flex-col gap-3 border-b border-line bg-white/95 px-7 pb-5 pt-6 backdrop-blur-xl">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="label text-muted">{eyebrow}</div>
          <h2 id={id} className="text-[22px] font-semibold leading-7 tracking-[-0.02em] text-balance text-ink">
            {title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={`${closeLabel} (Esc)`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-ink transition-[border-color,background-color,scale] duration-150 hover:border-ink hover:bg-surface active:scale-[0.96]"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {children}
    </div>
  );
}

/** Small action button for forms and fetchers; keeps focus while pending (aria-disabled, not disabled). */
export function ActionButton({
  children,
  tone = "outline",
  pending,
  pendingLabel,
  name,
  value,
  type = "submit",
  onClick,
  size = "sm",
  className,
  disabledReason,
}: {
  children: ReactNode;
  tone?: "ink" | "red" | "outline" | "ghost";
  pending?: boolean;
  pendingLabel?: string;
  name?: string;
  value?: string;
  type?: "submit" | "button";
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  size?: "sm" | "md";
  className?: string;
  /** Unavailable: stays focusable and explains why via title + aria-describedby text. */
  disabledReason?: string;
}) {
  const off = pending || !!disabledReason;
  return (
    <button
      type={type}
      name={name}
      value={value}
      aria-disabled={off || undefined}
      title={disabledReason}
      onClick={(e) => {
        if (off) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium transition-[background-color,border-color,color,scale,opacity] duration-150 ease-out",
        !off && "active:scale-[0.96]",
        size === "sm" ? "h-[30px] px-3.5 text-xs" : "h-9 px-4 text-[13px]",
        tone === "ink" && "bg-ink text-white hover:bg-ink-hover",
        tone === "red" && "bg-red text-white hover:bg-red-hover",
        tone === "outline" && "border border-line bg-white text-ink hover:border-ink",
        tone === "ghost" && "text-ink hover:bg-surface",
        disabledReason && "cursor-not-allowed opacity-50",
        pending && "cursor-progress",
        className,
      )}
    >
      {pending && <Spinner />}
      {pending && pendingLabel ? pendingLabel : children}
      {disabledReason && <span className="sr-only">, unavailable: {disabledReason}</span>}
    </button>
  );
}

export function Spinner() {
  return (
    <svg aria-hidden width="12" height="12" viewBox="0 0 12 12" className="animate-spin motion-reduce:animate-none">
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" fill="none" />
      <path d="M10.5 6A4.5 4.5 0 006 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** Polite status line; mounted empty so updates are announced. */
export function StatusLine({ message, tone = "ok", className }: { message?: string | null; tone?: "ok" | "error"; className?: string }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("text-xs leading-4", tone === "error" ? "text-red" : "text-subtle", className)}>
      <AnimatePresence initial={false} mode="popLayout">
        {message && (
          <motion.span key={message} className="inline-block" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease }}>
            {message}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

export const fieldCls =
  "h-9 w-full rounded-lg border border-control bg-white px-3 text-[13px] text-ink transition-colors duration-150 hover:border-ink focus-visible:border-ink";
