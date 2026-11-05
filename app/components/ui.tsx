import { animate, motion, useInView, useMotionValue, useReducedMotion } from "motion/react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { MenuButton } from "./menu";

export const ease = [0.22, 1, 0.36, 1] as const;
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/* ------------------------------------------------------------- icons */

export function Sparkle({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden className={cx("shrink-0", className)}>
      <path d="M8 1.5l1.6 4.4 4.4 1.6-4.4 1.6L8 13.5 6.4 9.1 2 7.5l4.4-1.6L8 1.5z" fill="var(--color-red)" />
    </svg>
  );
}

export function ArrowUp() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5l4 4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ----------------------------------------------------------- motion */

/*
 * First paint rule: anything rendered on the server (and re-rendered during hydration) must already
 * show its final state. Motion would otherwise serialise `initial` (opacity:0, width:0, "0%") into the
 * HTML, leaving the page blank until JS loads and requestAnimationFrame runs. <MotionRoot> (flow.tsx)
 * blocks `initial` for that first pass; anything mounted afterwards animates in normally.
 */
let hydrated = false;

/** False on the server and during the hydration render, true once the app has mounted on the client. */
export function useHydrated() {
  const [h, setH] = useState(hydrated);
  useEffect(() => {
    hydrated = true;
    setH(true);
  }, []);
  return h;
}

/** True for the lifetime of a component that was part of the server-rendered first paint. */
export function useFirstPaint() {
  const [first] = useState(() => !hydrated);
  return first;
}

export function Stagger({ children, className, delay = 0, gap = 0.05 }: { children: ReactNode; className?: string; delay?: number; gap?: number }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: gap, delayChildren: delay } } }}
    >
      {children}
    </motion.div>
  );
}

/** Enter ≤ 300ms with a short rise: these run inside a route that is itself fading in, so they stay subtle. */
export const item = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease } },
};

export function Item({ children, className, as = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" }) {
  const C = as === "section" ? motion.section : motion.div;
  return (
    <C variants={item} className={className}>
      {children}
    </C>
  );
}

/**
 * Animated number. Server/first paint renders the final value; components mounted after hydration
 * count up from zero once scrolled into view. Later value changes tween from the current value.
 */
export function CountUp({ value, format = (v) => String(Math.round(v)), className }: { value: number; format?: (v: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const firstPaint = useFirstPaint();
  const reduce = useReducedMotion();
  const inView = useInView(ref, { once: true });
  const mv = useMotionValue(firstPaint ? value : 0);
  const [display, setDisplay] = useState(() => format(firstPaint ? value : 0));
  const fmt = useRef(format);
  fmt.current = format;
  useEffect(() => mv.on("change", (v) => setDisplay(fmt.current(v))), [mv]);
  useEffect(() => {
    if (!inView) return;
    // Hidden tabs throttle requestAnimationFrame; never leave a zero on screen waiting for frames.
    if (reduce || document.visibilityState !== "visible") {
      mv.jump(value);
      setDisplay(fmt.current(value));
      return;
    }
    const c = animate(mv, value, { duration: 1, ease });
    return () => c.stop();
  }, [inView, value, mv, reduce]);
  return (
    <span ref={ref} className={cx("tabular-nums", className)}>
      {display}
    </span>
  );
}

/**
 * Horizontal bar that grows from zero (rendered full on first paint).
 * The fill is full-width and slides in with translateX (compositor-only, no per-frame layout);
 * the rounded track clips it, so the ends look the same as a width-sized fill.
 */
export function HBar({ pct, color = "bg-ink", track = "bg-line", h = 10, delay = 0, className }: { pct: number; color?: string; track?: string; h?: number; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className={cx("flex w-full overflow-hidden rounded-full", track, className)} style={{ height: h }}>
      <motion.div
        className={cx("w-full shrink-0 rounded-full", color)}
        style={{ height: h }}
        initial={{ x: "-100%" }}
        animate={{ x: `${p - 100}%` }}
        transition={reduce ? { duration: 0 } : { duration: 0.8, ease, delay }}
      />
    </div>
  );
}

/**
 * Vertical column that grows up from the baseline (rendered full on first paint).
 * Its final height is laid out from the start (no layout shift) and it grows with scaleY.
 */
export function VBar({ height, color = "bg-ink", delay = 0, radius = 8 }: { height: number; color?: string; delay?: number; radius?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={cx("w-full origin-bottom", color)}
      style={{ height, borderTopLeftRadius: radius, borderTopRightRadius: radius }}
      initial={{ scaleY: 0 }}
      animate={{ scaleY: 1 }}
      transition={reduce ? { duration: 0 } : { duration: 0.8, ease, delay }}
    />
  );
}

/* ------------------------------------------------------------ chrome */

type NavItem = { to: string; label: string; match: (p: string) => boolean };

const under = (prefix: string) => (p: string) => p === prefix || p.startsWith(prefix + "/");

/** Workspace dashboards; each highlights by path prefix (Programs only on "/"). Activities are threads below. */
const WORKSPACE: NavItem[] = [
  { to: "/", label: "Programs", match: (p) => p === "/" },
  { to: "/surveys", label: "Surveys", match: under("/surveys") },
  { to: "/integrations", label: "Integrations", match: under("/integrations") },
  { to: "/exports", label: "Exports", match: under("/exports") },
];

/** Account menu at the foot of the sidebar; opens upward from its bottom-left corner. */
function UserMenu() {
  return (
    <MenuButton
      placement="up-start"
      menuLabel="Account"
      items={[
        { type: "link", label: "Profile & settings", to: "/account" },
        { type: "link", label: "Institution: North Sound State", to: "/account#institution" },
        { type: "separator" },
        { type: "action", label: "Sign out", hint: "demo", disabled: true, onSelect: () => {} },
      ]}
      className={(open) =>
        cx(
          "group/user flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-[background-color,scale] duration-150 ease-out hover:bg-surface active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ink",
          open && "bg-surface",
        )
      }
    >
      {(open) => (
        <>
          <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-white">
            RO
          </span>
          <span className="flex min-w-0 grow flex-col">
            <span className="truncate text-[13px] font-medium text-ink">Dean R. Okafor</span>
            <span className="truncate text-xs text-muted">Dean, School of Business</span>
          </span>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className={cx("shrink-0 text-subtle transition-[rotate] duration-200 ease-out", open && "rotate-180")}>
            <path d="M3 7.5l3-3 3 3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </>
      )}
    </MenuButton>
  );
}

/** `activities`: the thread list (rendered by the shell, which owns the loader data). */
export function Sidebar({ activities }: { activities?: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <motion.aside
      // Mounted after hydration when leaving an activity: fades in with the dashboard, and out with it (the
      // shell's AnimatePresence keeps its width until then, so the page never reflows mid-fade).
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.3, ease } }}
      exit={{ opacity: 0, transition: { duration: 0.15, ease: "easeOut" } }}
      className="no-print sticky top-0 flex h-screen w-[248px] shrink-0 flex-col gap-7 border-r border-line bg-white px-4 py-6"
    >
      <Link to="/" className="group/logo flex items-center gap-2.5 rounded-md px-2">
        <span
          aria-hidden
          className="h-[22px] w-[22px] rounded-md bg-red transition-[rotate,scale] duration-200 ease-out-soft group-hover/logo:rotate-[8deg] group-hover/logo:scale-[1.06] group-active/logo:scale-[0.96]"
        />
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Program Studio</span>
      </Link>
      <nav aria-label="Primary" className="flex min-h-0 grow flex-col gap-5">
        <div role="group" aria-labelledby="nav-workspace" className="flex flex-col gap-0.5">
          <div id="nav-workspace" className="label px-2 pb-2 text-muted">
            Workspace
          </div>
          {WORKSPACE.map((n) => {
            const active = n.match(pathname);
            return (
              <Link key={n.label} to={n.to} prefetch="intent" aria-current={active ? "page" : undefined} className="group relative rounded-md">
                <div className="relative flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors duration-150 group-hover:bg-surface/60">
                  {active && (
                    <motion.div layoutId="nav-active" className="absolute inset-0 rounded-md bg-surface" transition={{ type: "spring", duration: 0.3, bounce: 0 }} />
                  )}
                  <div className={cx("relative h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-150", active && "bg-red")} />
                  <div className={cx("relative grow text-sm transition-colors duration-150", active ? "font-medium text-ink" : "text-subtle group-hover:text-ink")}>{n.label}</div>
                </div>
              </Link>
            );
          })}
        </div>
        {/* Threads scroll on their own; the account menu stays pinned to the foot. */}
        <div className="-mx-1 min-h-0 grow overflow-y-auto overscroll-contain px-1">{activities}</div>
      </nav>
      <UserMenu />
    </motion.aside>
  );
}

/**
 * What an activity adds to its stage bar (status, Close/Reopen, read-only or review-again banner).
 * Provided by the /a/:id layout, so the review and outcomes layouts don't need to know about it.
 */
/** `kicker`: word before the name in the eyebrow ("Activity" by default; null shows the name alone, as setup does). */
export type StageBarExtras = { status?: ReactNode; actions?: ReactNode; banner?: ReactNode; activity?: string; icon?: ReactNode; kicker?: string | null };
export const StageBarContext = createContext<StageBarExtras>({});

/** `done`: label shown under a completed stage (default "Done"); `false` hides it. */
export type Stage = { key: string; label: string; to: string; done?: string | false };

const isTyping = (el: Element | null) =>
  !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable);

/** Leaves the current activity: compact ← button with a "Dashboard" tooltip; Esc does the same. */
function ExitButton({ to }: { to: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (isTyping(document.activeElement) || document.querySelector("dialog[open], [aria-modal='true'], [role=dialog][open]")) return;
      navigate(to);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, to]);
  return (
    <Link to={to} prefetch="intent" aria-label="Back to dashboard (Esc)" aria-keyshortcuts="Escape" className="group/exit relative shrink-0 rounded-full">
      <span className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-white text-ink transition-[background-color,border-color,scale] duration-150 ease-out group-hover/exit:border-ink group-hover/exit:bg-surface group-active/exit:scale-[0.96]">
        <span className="transition-[translate] duration-200 ease-out-soft group-hover/exit:-translate-x-0.5">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M11.5 7h-9M2.5 7l4-4M2.5 7l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </span>
      {/* Visual only: the link's aria-label already carries the same words. Grows down from the button it labels. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-[calc(100%+8px)] z-30 flex origin-top-left -translate-y-0.5 items-center gap-1.5 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-[0_6px_16px_rgba(0,0,0,0.12)] transition-[opacity,translate] duration-150 ease-out group-hover/exit:translate-y-0 group-hover/exit:opacity-100 group-focus-visible/exit:translate-y-0 group-focus-visible/exit:opacity-100"
      >
        Dashboard <span className="font-mono text-[10px] text-white/60">esc</span>
      </span>
    </Link>
  );
}

type Cta = { label: string; to: string; tone?: "ink" | "red"; onClick?: () => void; form?: string };
type Chip = { text: string; tone: "red" | "muted" | "ink" } | null;

/**
 * The activity header row shared by every activity: ← exit (and Esc), kind icon + title, status label,
 * Close/Reopen and the primary action. Multi-step kinds add the stage nav below it (StageBar); single-page
 * kinds (survey, sync) use it alone (ActivityHeader).
 */
function HeaderRow({ title, subtitle, chip, cta, exitTo, name }: { title: string; subtitle: string; chip?: Chip; cta?: Cta; exitTo: string; name?: string }) {
  const extras = useContext(StageBarContext);
  return (
    <div className="flex h-9 items-center justify-between gap-6">
      <div className="flex min-w-0 items-center gap-3">
        <ExitButton to={exitTo} />
        <div className="flex min-w-0 flex-col gap-0.5">
          {(name || extras.status) && (
            <div className="label flex min-w-0 items-center gap-1.5 text-[10px] leading-3 text-muted">
              {extras.icon}
              {name && <span className="truncate">{extras.kicker === null ? name : `${extras.kicker ?? "Activity"} · ${name}`}</span>}
              {extras.status && (
                <>
                  <span aria-hidden>·</span>
                  <span className="normal-case tracking-normal text-[11px]">{extras.status}</span>
                </>
              )}
            </div>
          )}
          <div className="flex min-w-0 items-baseline gap-2.5">
            <div className="shrink-0 text-[15px] font-semibold leading-[18px] text-ink">{title}</div>
            <motion.div key={subtitle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, ease }} title={subtitle} className="truncate text-[13px] leading-4 text-muted">
              {subtitle}
            </motion.div>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        {chip && (
          <motion.div
            layout
            role="status"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2, ease }}
            className={cx("flex h-8 origin-right items-center gap-2 rounded-full px-3 text-xs tabular-nums", chip.tone === "red" ? "bg-red-soft text-red-deep" : "bg-surface text-subtle")}
          >
            <span aria-hidden className="relative flex h-[7px] w-[7px]">
              {/* A few pulses to draw the eye, then still: nothing loops indefinitely (WCAG 2.2.2). */}
              {chip.tone === "red" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red opacity-60 [animation-iteration-count:3] motion-reduce:hidden" />}
              <span className={cx("relative inline-flex h-[7px] w-[7px] rounded-full", chip.tone === "red" ? "bg-red" : chip.tone === "ink" ? "bg-ink" : "bg-muted")} />
            </span>
            {chip.text}
          </motion.div>
        )}
        {extras.actions}
        {cta &&
          (cta.form ? (
            <Button type="submit" form={cta.form} tone={cta.tone ?? "ink"}>
              {cta.label}
            </Button>
          ) : (
            <Button to={cta.to} tone={cta.tone ?? "ink"} onClick={cta.onClick}>
              {cta.label}
            </Button>
          ))}
      </div>
    </div>
  );
}

const barShell = "no-print sticky top-0 z-20 flex shrink-0 flex-col gap-3.5 border-b border-line bg-white/90 px-10 pb-4 pt-[18px] backdrop-blur-xl";

/** Slim header for single-page activities (survey, sync): no stage pills, no progress fill. */
export function ActivityHeader({ title, subtitle, chip, cta, exitTo = "/" }: { title: string; subtitle: string; chip?: Chip; cta?: Cta; exitTo?: string }) {
  const extras = useContext(StageBarContext);
  return (
    <div data-stagebar className={barShell}>
      <HeaderRow title={title} subtitle={subtitle} chip={chip} cta={cta} exitTo={exitTo} name={extras.activity} />
      {extras.banner}
    </div>
  );
}

/** Header plus stage progress, for multi-step flows only (review, outcomes, workspace setup). */
export function StageBar({
  title,
  subtitle,
  stages,
  current,
  progress,
  sub,
  chip,
  cta,
  exitTo = "/",
  activity,
}: {
  title: string;
  subtitle: string;
  stages: Stage[];
  current: number;
  progress: number;
  sub?: string;
  chip?: Chip;
  /** `form`: id of a <form> the CTA submits (e.g. setup's "Send surveys & finish"). */
  cta: Cta;
  /** Where the ← exit button (and Esc) goes. */
  exitTo?: string;
  /** Activity name for the eyebrow; defaults to the one the /a/:id layout provides. */
  activity?: string;
}) {
  const extras = useContext(StageBarContext);
  const name = activity ?? extras.activity;
  return (
    <div data-stagebar className={barShell}>
      <HeaderRow title={title} subtitle={subtitle} chip={chip} cta={cta} exitTo={exitTo} name={name} />
      <nav aria-label={name ? `${name} stages` : "Stages"} className="flex gap-1.5">
        {stages.map((s, i) => {
          const done = i < current;
          const now = i === current;
          const fill = done ? 100 : now ? Math.max(0, Math.min(1, progress)) * 100 : 0;
          const doneLabel = s.done === undefined ? "Done" : s.done;
          return (
            <Link key={s.key} to={s.to} prefetch="intent" aria-current={now ? "step" : undefined} className="group flex min-w-0 flex-1 flex-col gap-2 rounded-sm">
              <div className="flex h-1 overflow-hidden rounded-full bg-line transition-colors duration-150 group-hover:bg-line-hover">
                {/* Full-width fill slid in with translateX: compositor-only, and the rounded track clips it. */}
                <motion.div
                  className={cx("h-1 w-full shrink-0 rounded-full transition-[background-color] delay-300 duration-[400ms]", done ? "bg-ink" : "bg-red")}
                  initial={false}
                  animate={{ x: `${fill - 100}%` }}
                  transition={{ duration: 0.7, ease }}
                />
              </div>
              <div className="flex items-center gap-1.5 leading-4">
                {done ? (
                  <motion.span aria-hidden initial={{ scale: 0.25, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", duration: 0.3, bounce: 0 }} className="text-[11px] text-ink">
                    ✓
                  </motion.span>
                ) : (
                  <span aria-hidden className={cx("font-mono text-[11px] tabular-nums", now ? "text-red" : "text-muted")}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                )}
                <span className={cx("truncate text-[13px] transition-colors duration-150", now ? "font-semibold text-ink" : done ? "font-medium text-ink" : "text-subtle group-hover:text-ink")}>
                  {s.label}
                </span>
                {now && sub && <span className="truncate text-xs text-muted">{sub}</span>}
                {done && doneLabel ? <span className="truncate text-xs text-muted">{doneLabel}</span> : done ? <span className="sr-only">, done</span> : null}
              </div>
            </Link>
          );
        })}
      </nav>
      {extras.banner}
    </div>
  );
}

export function Button({
  to,
  children,
  tone = "ink",
  onClick,
  size = "md",
  className,
  static: isStatic,
  type = "button",
  disabled,
  autoFocus,
  name,
  value,
  form,
  ...aria
}: {
  to?: string;
  children: ReactNode;
  tone?: "ink" | "red" | "outline" | "ghost";
  onClick?: () => void;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Opts out of the 0.96 press scale. */
  static?: boolean;
  type?: "button" | "submit";
  disabled?: boolean;
  autoFocus?: boolean;
  name?: string;
  value?: string;
  form?: string;
  "aria-haspopup"?: "dialog" | "menu";
  "aria-describedby"?: string;
}) {
  const cls = cx(
    "inline-flex items-center justify-center whitespace-nowrap rounded-full font-medium transition-[background-color,border-color,color,scale,opacity] duration-150 ease-out disabled:opacity-60",
    !isStatic && "not-disabled:active:scale-[0.96]",
    size === "sm" ? "h-[30px] px-3.5 text-xs" : size === "lg" ? "h-11 px-5 text-sm" : "h-9 px-4 text-[13px]",
    tone === "ink" && "bg-ink text-white hover:bg-ink-hover",
    // Brand #f54562 under white 13px text is 3.55:1; red-deep is 5.3:1 and its hover 6.3:1 (WCAG 1.4.3).
    tone === "red" && "bg-red-deep text-white hover:bg-red-deep-hover",
    tone === "outline" && "border border-line bg-white text-ink hover:border-ink",
    tone === "ghost" && "text-ink hover:bg-surface",
    className,
  );
  if (to) {
    return (
      <Link to={to} onClick={onClick} prefetch="intent" className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} className={cls} disabled={disabled} autoFocus={autoFocus} name={name} value={value} form={form} {...aria}>
      {children}
    </button>
  );
}

export function Eyebrow({ children, tone = "red" }: { children: ReactNode; tone?: "red" | "muted" | "ink" }) {
  return <div className={cx("label", tone === "red" ? "text-red" : tone === "ink" ? "text-ink" : "text-muted")}>{children}</div>;
}

export function PageHead({
  eyebrow,
  title,
  sub,
  width,
  className,
  subClassName,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  width?: number;
  /** Extra classes for the wrapper (gap, margins). */
  className?: string;
  /** Overrides for the sub line, e.g. "leading-6" or "text-sm"; merged after the defaults so utilities win. */
  subClassName?: string;
}) {
  return (
    <Item className={cx("flex flex-col gap-2", className)}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 className="text-[32px] font-semibold leading-[38px] tracking-[-0.03em] text-balance text-ink" style={{ maxWidth: width }}>
        {title}
      </h1>
      {sub && (
        <p className={cx("text-[15px] leading-[22px] text-pretty text-subtle", subClassName)} style={{ maxWidth: width }}>
          {sub}
        </p>
      )}
    </Item>
  );
}

export function Toggle({
  on,
  onChange,
  tone = "ink",
  size = "md",
  label,
}: {
  on: boolean;
  onChange?: (v: boolean) => void;
  tone?: "ink" | "red";
  size?: "sm" | "md";
  /** Accessible name; required unless the switch is labelled by adjacent text via a wrapping <label>. */
  label?: string;
}) {
  const sm = size === "sm";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange?.(!on)}
      className={cx(
        // after: grows the hit area to at least 24px tall (WCAG 2.5.8) without changing the visual size.
        "relative flex shrink-0 rounded-full p-0.5 transition-colors duration-150 ease-out after:absolute after:-inset-1 after:content-['']",
        sm ? "h-[18px] w-8" : "h-[22px] w-[38px]",
        on ? (tone === "red" ? "bg-red" : "bg-ink") : "bg-line",
      )}
    >
      {/*
        Knob slides with a CSS translate (compositor-only, retargets mid-flight, SSR-safe). Not a Motion `layout`
        animation: that re-measures on every render and slides the knob whenever the row around it reflows.
      */}
      <span
        aria-hidden
        className={cx(
          "rounded-full bg-white shadow-sm transition-[translate] duration-200 ease-out-soft",
          sm ? "h-3.5 w-3.5" : "h-[18px] w-[18px]",
          on && (sm ? "translate-x-3.5" : "translate-x-4"),
        )}
      />
    </button>
  );
}

/** Checkbox visual. Interactive (a <button>) only when given onClick, so it can sit inside a clickable row. */
export function Check({ on, onClick, label }: { on: boolean; onClick?: () => void; /** Accessible name for the interactive form. */ label?: string }) {
  const cls = cx(
    "flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-xs text-white transition-colors duration-150",
    on ? "bg-ink" : "border-[1.5px] border-control bg-white",
  );
  const mark = (
    // CSS cross-fade (retargets mid-flight; no inline opacity:0 in the server HTML).
    <span aria-hidden className={cx("transition-[opacity,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)]", on ? "scale-100 opacity-100" : "scale-25 opacity-0")}>
      ✓
    </span>
  );
  if (!onClick) {
    return (
      <span className={cls} aria-hidden>
        {mark}
      </span>
    );
  }
  return (
    <button type="button" role="checkbox" aria-checked={on} aria-label={label} onClick={onClick} className={cx(cls, "relative after:absolute after:-inset-1 after:content-['']")}>
      {mark}
    </button>
  );
}

export function AgentNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("flex gap-2.5 rounded-xl bg-surface px-4 py-3.5 text-[13px] leading-[19px] text-text", className)}>
      <Sparkle className="mt-[3px]" />
      <div>{children}</div>
    </div>
  );
}

export function SynthTag({ children = "SYNTHETIC · DEMO" }: { children?: ReactNode }) {
  return <div className="label inline-flex items-center rounded-full border border-dashed border-muted px-3 py-1.5 text-[11px] text-subtle">{children}</div>;
}

/**
 * Typed-out text, used for agent responses. Text that was server-rendered shows in full immediately.
 * Screen readers get the whole string at once; the typing is visual only.
 */
export function Typewriter({ text, speed = 12, delay = 0, className }: { text: string; speed?: number; delay?: number; className?: string }) {
  const firstPaint = useFirstPaint();
  const reduce = useReducedMotion();
  const painted = useRef(firstPaint ? text : null);
  const [n, setN] = useState(firstPaint ? text.length : 0);
  useEffect(() => {
    if (painted.current === text || reduce) {
      setN(text.length);
      return;
    }
    painted.current = null;
    setN(0);
    let i = 0;
    let timer: ReturnType<typeof setInterval>;
    const start = setTimeout(() => {
      timer = setInterval(() => {
        i += 2;
        setN(i);
        if (i >= text.length) clearInterval(timer);
      }, speed);
    }, delay);
    return () => {
      clearTimeout(start);
      clearInterval(timer);
    };
  }, [text, speed, delay, reduce]);
  if (n >= text.length) return <span className={className}>{text}</span>;
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>{text.slice(0, n)}</span>
    </span>
  );
}

export const money = (v: number | null | undefined, digits = 1) => (v == null ? "—" : `$${(v / 1000).toFixed(digits)}k`);
