import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { cx } from "~/components/ui";

/*
 * The programs table's activity menu: an APG menu button like components/menu.tsx, plus one thing it can't do,
 * an inline two-step confirm. An entry with `confirm` turns into "Send now?" on the first activation and
 * stays open; the second activation runs it. Moving to another item, Esc or closing the menu cancels.
 *   Trigger: Enter / Space / ArrowDown open on the first item, ArrowUp on the last.
 *   Menu: ArrowUp/Down (wrapping), Home/End, Enter/Space activate, Esc cancels a confirm or closes, Tab closes.
 */

export type Entry =
  | { type: "link"; key: string; icon?: ReactNode; label: string; hint?: string; to: string }
  | { type: "action"; key: string; icon?: ReactNode; label: string; hint?: string; onSelect: () => void; disabled?: string; confirm?: { label: string; hint: string } }
  | { type: "separator"; key: string }
  | { type: "heading"; key: string; label: string };

export function ActivityMenu({
  label,
  entries,
  className,
  children,
}: {
  label: string;
  entries: Entry[];
  className: (open: boolean) => string;
  children: (open: boolean) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [focusAt, setFocusAt] = useState<"first" | "last">("first");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pos, setPos] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  const show = (at: "first" | "last") => {
    const r = trigger.current?.getBoundingClientRect();
    if (r) {
      // Opens downward unless there's too little room below, then upward; always right-aligned to the trigger.
      const below = window.innerHeight - r.bottom;
      setPos(below < 300 && r.top > below ? { right: Math.max(8, window.innerWidth - r.right), bottom: window.innerHeight - r.top + 4 } : { right: Math.max(8, window.innerWidth - r.right), top: r.bottom + 4 });
    }
    setFocusAt(at);
    setConfirming(null);
    setOpen(true);
  };
  const hide = useCallback((refocus: boolean) => {
    setOpen(false);
    setConfirming(null);
    if (refocus) trigger.current?.focus();
  }, []);

  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];

  useLayoutEffect(() => {
    if (!open) return;
    const els = items();
    (focusAt === "last" ? els[els.length - 1] : els[0])?.focus();
  }, [open, focusAt]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !trigger.current?.contains(t)) hide(false);
    };
    const onMove = (e: Event) => {
      if (e.target instanceof Node && menu.current?.contains(e.target)) return;
      hide(false);
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, hide]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const els = items();
    const i = els.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      setConfirming(null);
      els[(n + els.length) % els.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(els.length - 1);
    else if (e.key === "Escape") {
      // Handled here so Esc never also closes the slide-over or leaves the page.
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      if (confirming) setConfirming(null);
      else hide(true);
    } else if (e.key === "Tab") hide(false);
  };

  const confirmingEntry = entries.find((x) => x.key === confirming && x.type === "action") as Extract<Entry, { type: "action" }> | undefined;
  const itemCls = "flex w-full items-center justify-between gap-6 rounded-md px-2.5 py-[7px] text-left text-[13px] leading-4 outline-none transition-colors duration-100";

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label={label}
        onClick={() => (open ? hide(false) : show("first"))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            show(e.key === "ArrowUp" ? "last" : "first");
          }
        }}
        className={className(open)}
      >
        {children(open)}
      </button>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                ref={menu}
                id={`${id}-menu`}
                role="menu"
                aria-label={label}
                onKeyDown={onMenuKey}
                style={{ position: "fixed", ...pos }}
                className={cx(
                  "z-[60] flex w-[300px] flex-col overscroll-contain rounded-xl border border-line bg-white p-1 shadow-[0_12px_32px_rgba(0,0,0,0.10),0_2px_6px_rgba(0,0,0,0.04)]",
                  "bottom" in pos ? "origin-bottom-right" : "origin-top-right",
                )}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1, transition: { type: "spring", duration: 0.25, bounce: 0 } }}
                exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15, ease: "easeOut" } }}
              >
                {entries.map((it) => {
                  if (it.type === "separator") return <div key={it.key} role="separator" className="my-1 h-px bg-line" />;
                  if (it.type === "heading")
                    return (
                      <div key={it.key} role="presentation" className="label px-2.5 pb-1 pt-2 text-muted">
                        {it.label}
                      </div>
                    );
                  if (it.type === "link")
                    return (
                      <Link key={it.key} role="menuitem" tabIndex={-1} to={it.to} onClick={() => hide(false)} className={cx(itemCls, "text-ink hover:bg-surface focus-visible:bg-surface")}>
                        <span className="flex min-w-0 items-center gap-2">
                          {it.icon}
                          <span className="truncate">{it.label}</span>
                        </span>
                        {it.hint && <span className="shrink-0 text-[11px] text-muted">{it.hint}</span>}
                      </Link>
                    );
                  const isConfirming = confirming === it.key;
                  return (
                    <button
                      key={it.key}
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      aria-disabled={it.disabled ? true : undefined}
                      onFocus={() => confirming && confirming !== it.key && setConfirming(null)}
                      onClick={() => {
                        if (it.disabled) return;
                        if (it.confirm && !isConfirming) {
                          setConfirming(it.key);
                          return;
                        }
                        hide(true);
                        it.onSelect();
                      }}
                      className={cx(
                        itemCls,
                        "flex-col items-stretch gap-0.5",
                        it.disabled ? "cursor-default text-muted" : isConfirming ? "bg-red-soft text-red-deep" : "text-ink hover:bg-surface focus-visible:bg-surface",
                      )}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2 font-medium">
                          {it.icon}
                          <span className="truncate">{isConfirming && it.confirm ? it.confirm.label : it.label}</span>
                        </span>
                        {isConfirming && (
                          <span aria-hidden className="shrink-0 rounded-full bg-red px-2 py-0.5 text-[11px] font-medium text-white">
                            Send
                          </span>
                        )}
                      </span>
                      <span className={cx("pl-5 text-[11px] leading-[15px]", isConfirming ? "text-red-deep" : "text-muted")}>
                        {it.disabled ? it.disabled : isConfirming && it.confirm ? it.confirm.hint : it.hint}
                      </span>
                    </button>
                  );
                })}
                {/* Mounted with the menu, so the confirm prompt is announced when it appears. */}
                <div role="status" className="sr-only">
                  {confirmingEntry?.confirm ? `${confirmingEntry.confirm.label} ${confirmingEntry.confirm.hint}` : ""}
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
