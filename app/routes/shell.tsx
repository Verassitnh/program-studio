import { AnimatePresence } from "motion/react";
import { useEffect, useState } from "react";
import { redirect, useLocation, type ShouldRevalidateFunctionArgs } from "react-router";
import { ActivityThreads, FinishSetup } from "~/components/activities";
import { AnimatedOutlet } from "~/components/flow";
import { Sidebar } from "~/components/ui";
import { listThreads } from "~/lib/activities.server";
import { getOnboarding } from "~/lib/onboarding.server";
import type { Route } from "./+types/shell";

export async function loader({ request }: Route.LoaderArgs) {
  const onboarding = await getOnboarding();
  // First visit to the dashboard before setup has ever started: go through setup (it can be skipped).
  if (onboarding.status === "not_started" && new URL(request.url).pathname === "/") throw redirect("/onboarding");
  return {
    threads: await listThreads(),
    now: Date.now(),
    setup: onboarding.status === "completed" || onboarding.bannerDismissed ? null : { status: onboarding.status, step: onboarding.step },
  };
}

/** Fullscreen sections: activities and workspace setup hide the sidebar. */
const fullscreenPath = (p: string) => p.startsWith("/a/") || p === "/onboarding" || p.startsWith("/onboarding/");

/**
 * The thread list only shows on dashboards, so refresh it when coming back from an activity (its stage,
 * status and position will have moved), after any form submission, and otherwise as React Router would.
 */
export function shouldRevalidate({ currentUrl, nextUrl, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (fullscreenPath(currentUrl.pathname) !== fullscreenPath(nextUrl.pathname)) return true;
  return defaultShouldRevalidate;
}

/** Cross-fade key: one per dashboard page, one per activity (each activity animates its own stages). */
const sectionKey = (pathname: string) => {
  const parts = pathname.split("/").filter(Boolean);
  return "/" + parts.slice(0, parts[0] === "a" ? 2 : 1).join("/");
};

/** AnimatedOutlet's exit (flow.tsx): the outgoing route fades for 150ms before the next one mounts. */
const OUTLET_EXIT_MS = 150;

/**
 * Whether the sidebar is in the layout. Its width must only change while the content column is invisible,
 * or the outgoing page visibly reflows mid-fade:
 *   into fullscreen   it starts fading out at once, and AnimatePresence keeps its width until the page has faded;
 *   out of fullscreen it mounts once the activity has faded out, together with the dashboard fading in.
 */
function useSidebar(fullscreen: boolean) {
  const [shown, setShown] = useState(!fullscreen);
  useEffect(() => {
    if (fullscreen) return setShown(false);
    const t = setTimeout(() => setShown(true), OUTLET_EXIT_MS);
    return () => clearTimeout(t);
  }, [fullscreen]);
  return shown && !fullscreen;
}

export default function Shell({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  // Activities are fullscreen: no sidebar on /a/*. The stage bar's ← (or Esc) returns to the dashboard.
  const fullscreen = fullscreenPath(pathname);
  const sidebar = useSidebar(fullscreen);
  return (
    <div className="flex min-h-screen bg-white">
      {/* First tab stop: jumps past the sidebar. Hidden until focused. */}
      {sidebar && (
        <a href="#main" className="skip-link rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-white">
          Skip to content
        </a>
      )}
      <AnimatePresence initial={false}>
        {sidebar && (
          <Sidebar
            key="sidebar"
            activities={
              <>
                {loaderData.setup && <FinishSetup step={loaderData.setup.step} />}
                <ActivityThreads threads={loaderData.threads} now={loaderData.now} />
              </>
            }
          />
        )}
      </AnimatePresence>
      <main id="main" tabIndex={-1} className="flex min-w-0 grow flex-col focus:outline-none">
        <AnimatedOutlet keyOf={sectionKey} className="flex grow flex-col" />
      </main>
    </div>
  );
}
