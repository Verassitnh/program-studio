import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";

/*
 * APG menu button. The trigger is a <button aria-haspopup="menu" aria-expanded>; the menu is portaled to
 * <body> with fixed positioning so scrolling lists and the sidebar's edges never clip it.
 *   Enter / Space / ArrowDown on the trigger: open, focus the first item. ArrowUp: open, focus the last.
 *   In the menu: ArrowUp/Down move (wrapping), Home/End jump, Enter/Space activate,
 *   Escape closes and refocuses the trigger, Tab closes and moves on. A click outside closes.
 */

export type MenuItem =
  | { type: "link"; label: ReactNode; to: string; hint?: ReactNode }
  | { type: "action"; label: ReactNode; onSelect: () => void; hint?: ReactNode; tone?: "default" | "danger"; disabled?: boolean }
  | { type: "separator" };

type Placement = "up-start" | "down-end";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function MenuButton({
  label,
  items,
  placement = "down-end",
  className,
  children,
  menuLabel,
  onOpenChange,
}: {
  /** Accessible name of the trigger (and of the menu, unless menuLabel is given). */
  label?: string;
  items: MenuItem[];
  placement?: Placement;
  className?: string | ((open: boolean) => string);
  /** Trigger contents; a function receives the open state (for rotating chevrons and the like). */
  children: ReactNode | ((open: boolean) => ReactNode);
  menuLabel?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [focusAt, setFocusAt] = useState<"first" | "last">("first");
  const [pos, setPos] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const triggerId = `${id}-trigger`;
  const menuId = `${id}-menu`;

  const place = useCallback(() => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    setPos(
      placement === "up-start"
        ? { left: r.left, bottom: window.innerHeight - r.top + 6 }
        : { right: Math.max(8, window.innerWidth - r.right), top: r.bottom + 4 },
    );
  }, [placement]);

  const show = (at: "first" | "last") => {
    place();
    setFocusAt(at);
    setOpen(true);
  };
  const hide = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);

  useEffect(() => onOpenChange?.(open), [open, onOpenChange]);

  const enabled = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];

  // Focus moves into the menu once it has mounted.
  useLayoutEffect(() => {
    if (!open) return;
    const els = enabled();
    (focusAt === "last" ? els[els.length - 1] : els[0])?.focus();
  }, [open, focusAt]);

  // Click outside, scroll or resize closes it (the fixed position would go stale).
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

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      show(e.key === "ArrowUp" ? "last" : "first");
    }
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const els = enabled();
    const i = els.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      els[(n + els.length) % els.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(els.length - 1);
    else if (e.key === "Escape") {
      // Handled here so Esc never also leaves the page (the stage bar's Esc shortcut checks defaultPrevented).
      e.preventDefault();
      e.stopPropagation();
      hide(true);
    } else if (e.key === "Tab") hide(true);
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      // Type-ahead: first item starting with the typed character.
      const k = e.key.toLowerCase();
      const start = i + 1;
      const order = [...els.slice(start), ...els.slice(0, start)];
      order.find((el) => el.textContent?.trim().toLowerCase().startsWith(k))?.focus();
    }
  };

  const up = placement === "up-start";
  const itemCls =
    "flex w-full items-center justify-between gap-6 rounded-md px-2.5 py-[7px] text-left text-[13px] leading-4 outline-none transition-colors duration-100 focus-visible:bg-surface hover:bg-surface";

  return (
    <>
      <button
        ref={trigger}
        id={triggerId}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => (open ? hide(false) : show("first"))}
        onKeyDown={onTriggerKey}
        className={typeof className === "function" ? className(open) : className}
      >
        {typeof children === "function" ? children(open) : children}
      </button>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                ref={menu}
                id={menuId}
                role="menu"
                aria-labelledby={menuLabel ? undefined : triggerId}
                aria-label={menuLabel}
                onKeyDown={onMenuKey}
                style={{ position: "fixed", ...pos }}
                // Grows from the corner it is anchored to.
                className={cx(
                  "z-50 flex min-w-[200px] flex-col overscroll-contain rounded-xl border border-line bg-white p-1 shadow-[0_12px_32px_rgba(0,0,0,0.10),0_2px_6px_rgba(0,0,0,0.04)]",
                  up ? "origin-bottom-left" : "origin-top-right",
                )}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1, transition: { type: "spring", duration: 0.25, bounce: 0 } }}
                exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15, ease: "easeOut" } }}
              >
                {items.map((it, i) => {
                  if (it.type === "separator") return <div key={i} role="separator" className="my-1 h-px bg-line" />;
                  if (it.type === "link") {
                    return (
                      <Link key={i} role="menuitem" tabIndex={-1} to={it.to} onClick={() => hide(false)} className={cx(itemCls, "text-ink")}>
                        <span>{it.label}</span>
                        {it.hint && <span className="text-[11px] text-muted"><span className="sr-only">, </span>{it.hint}</span>}
                      </Link>
                    );
                  }
                  return (
                    <button
                      key={i}
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      aria-disabled={it.disabled || undefined}
                      onClick={() => {
                        if (it.disabled) return;
                        hide(true);
                        it.onSelect();
                      }}
                      className={cx(itemCls, it.disabled ? "cursor-default text-muted hover:bg-transparent" : it.tone === "danger" ? "text-red-deep" : "text-ink")}
                    >
                      <span>{it.label}</span>
                      {it.hint && <span className="text-[11px] text-muted"><span className="sr-only">, </span>{it.hint}</span>}
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
