import { AnimatePresence, MotionConfig, PresenceContext, motion, useIsPresent } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  UNSAFE_DataRouterDataContext as DataCtx,
  UNSAFE_DataRouterStateContext as StateCtx,
  UNSAFE_LocationContext as LocationCtx,
  useLocation,
  useOutlet,
} from "react-router";
import { useActivityState } from "./activities";
import { ease, useHydrated } from "./ui";

/*
 * SSR-safe motion.
 *
 * Motion skips a component's `initial` state when the nearest PresenceContext says `initial: false`
 * (that's how <AnimatePresence initial={false}> works). We provide that context for the server render
 * and the hydration render only, so the HTML contains final values (no opacity:0 / width:0 / "0%"),
 * and switch it off once hydrated so everything mounted later animates in as designed.
 * It must stay non-null for the app's lifetime: motion's usePresence() picks its hook path by nullness.
 */
const noop = () => {};
const register = () => noop;

function FirstPaintPresence({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  const value = useMemo(
    () => ({ id: "first-paint", isPresent: true, register, initial: hydrated ? undefined : (false as const) }),
    [hydrated],
  );
  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

/** Background tabs pause requestAnimationFrame; snap animations to their end state rather than queueing them. */
function usePageHidden() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const update = () => setHidden(document.visibilityState === "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return hidden;
}

/** App-wide motion defaults: honour prefers-reduced-motion, and never server-render hidden content. */
export function MotionRoot({ children }: { children: ReactNode }) {
  const hidden = usePageHidden();
  return (
    <MotionConfig reducedMotion="user" skipAnimations={hidden}>
      <FirstPaintPresence>{children}</FirstPaintPresence>
    </MotionConfig>
  );
}

/**
 * Re-provides the surrounding AnimatePresence context with `initial` released after hydration.
 * AnimatePresence memoises `initial: false` for the lifetime of its first child, which would otherwise
 * stop every entrance animation inside the first route a visitor lands on.
 */
function ReleaseInitial({ children }: { children: ReactNode }) {
  const parent = useContext(PresenceContext);
  const hydrated = useHydrated();
  const value = useMemo(() => (parent ? { ...parent, initial: hydrated ? undefined : (false as const) } : parent), [parent, hydrated]);
  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

/**
 * Keeps the outgoing route rendered exactly as it was while it animates out: the outlet element plus the
 * location and loader data it rendered with, so nested layouts don't react to the next URL mid-exit
 * (and route components never see their loaderData disappear).
 */
function Frozen({ children }: { children: ReactNode }) {
  const isPresent = useIsPresent();
  const location = useContext(LocationCtx);
  const state = useContext(StateCtx);
  const data = useContext(DataCtx);
  const last = useRef({ children, location, state, data });
  if (isPresent) last.current = { children, location, state, data };
  const f = last.current;
  return (
    <LocationCtx.Provider value={f.location}>
      <StateCtx.Provider value={f.state}>
        <DataCtx.Provider value={f.data}>{f.children}</DataCtx.Provider>
      </StateCtx.Provider>
    </LocationCtx.Provider>
  );
}

/**
 * Cross-fades between child routes. `depth` picks how many path segments form the key, so a parent
 * layout can transition between sections without remounting on every nested step (default: full path).
 */
export function AnimatedOutlet({ className, depth, keyOf }: { className?: string; depth?: number; keyOf?: (pathname: string) => string }) {
  const outlet = useOutlet();
  const { pathname } = useLocation();
  const key = keyOf ? keyOf(pathname) : depth ? "/" + pathname.split("/").filter(Boolean).slice(0, depth).join("/") : pathname;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={key}
        className={className}
        // Enter 300ms ease-out; exit shorter (150ms) and also ease-out so the outgoing view responds at once.
        // Movement stays small (8px in, 4px out) because the whole page moves; reduced motion keeps only the fade.
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.3, ease } }}
        exit={{ opacity: 0, y: -4, transition: { duration: 0.15, ease: "easeOut" } }}
      >
        <ReleaseInitial>
          <Frozen>{outlet}</Frozen>
        </ReleaseInitial>
      </motion.div>
    </AnimatePresence>
  );
}

/* ---------------------------------------------- review change package */

type ReviewState = {
  selected: Record<string, boolean>;
  toggle: (id: string) => void;
  init: (defaults: Record<string, boolean>) => void;
  /** True when the activity is closed: selections show but can't change. */
  readOnly: boolean;
};

const Ctx = createContext<ReviewState | null>(null);

/**
 * The review's change selections, saved on the activity (studio.activities.state.changes) through a fetcher.
 * The activity loader renders the saved selections on the server, so there's no flash; until the dean
 * changes something, the build stage's defaults apply (and aren't saved).
 */
export function ReviewProvider({ children }: { children: ReactNode }) {
  const [saved, save, { readOnly }] = useActivityState<Record<string, boolean>>("changes", {});
  const [defaults, setDefaults] = useState<Record<string, boolean>>({});
  const base = useRef(defaults);
  base.current = defaults;
  // Saved choices win; changes added since (e.g. after a data sync) fall back to their defaults.
  const selected = useMemo(() => ({ ...defaults, ...saved }), [defaults, saved]);
  const toggle = useCallback(
    (id: string) =>
      save((prev) => {
        const from = { ...base.current, ...prev };
        return { ...from, [id]: !from[id] };
      }),
    [save],
  );
  const init = useCallback((d: Record<string, boolean>) => setDefaults((s) => (Object.keys(s).length ? s : d)), []);
  const value: ReviewState = { selected, toggle, init, readOnly };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useReview() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useReview outside ReviewProvider");
  return v;
}
