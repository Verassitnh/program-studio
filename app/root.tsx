import { isRouteErrorResponse, Link, Links, Meta, Outlet, Scripts, ScrollRestoration, useLocation } from "react-router";

import type { Route } from "./+types/root";
import { MotionRoot } from "./components/flow";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@100..900&display=swap",
  },
];

/** Most specific first (WCAG 2.4.2). Activity routes (/a/:id/...) set their own titles. */
const PAGES: Record<string, string> = { surveys: "Surveys", integrations: "Integrations", exports: "Exports", account: "Account" };

export const meta: Route.MetaFunction = ({ location, error }) => {
  const [section] = location.pathname.split("/").filter(Boolean);
  const page = error ? (isRouteErrorResponse(error) && error.status === 404 ? "Not found" : "Error") : section ? PAGES[section] : "Programs";
  return [{ title: [page, "Program Studio", "Lightcast"].filter(Boolean).join(" · ") }];
};

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <MotionRoot>
      <Outlet />
    </MotionRoot>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { pathname } = useLocation();
  const inActivity = pathname.startsWith("/a/");
  let message = "Something went wrong";
  let details = "An unexpected error occurred. Try again, or go back to Programs.";
  let stack: string | undefined;
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      message = inActivity ? "Activity not found" : "Page not found";
      details = inActivity
        ? "This activity doesn’t exist, or the link is incomplete. Your activities are listed in the sidebar on Programs."
        : "There’s no page at this address. Check the link, or go back to Programs.";
    } else {
      message = `Error ${error.status}`;
      // Loaders throw short, user-facing strings via data("…", { status }); anything else falls back to the status text.
      details = typeof error.data === "string" && error.data.length < 200 ? error.data : error.statusText || details;
    }
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }
  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col items-start p-16">
      <div className="label text-red">Program Studio</div>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance text-ink">{message}</h1>
      <p className="mt-3 text-pretty text-subtle">{details}</p>
      {details.includes("connect") || details.includes("does not exist") ? (
        <p className="mt-3 text-sm text-subtle">
          Run <code className="font-mono">npm run db:import</code> to create and load the local database.
        </p>
      ) : null}
      {/* A plain link (not the shared Button): the boundary must render even if a shared module is what failed. */}
      <Link
        to="/"
        className="mt-8 inline-flex h-9 items-center rounded-full bg-ink px-4 text-[13px] font-medium text-white transition-[background-color,scale] duration-150 ease-out hover:bg-ink-hover active:scale-[0.96]"
      >
        ← Back to Programs
      </Link>
      {stack && <pre className="mt-6 max-w-full overflow-x-auto rounded-xl bg-surface p-4 text-xs">{stack}</pre>}
    </main>
  );
}
