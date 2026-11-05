import { useEffect, useRef } from "react";
import { useLoaderData, useLocation, useParams, type ShouldRevalidateFunctionArgs } from "react-router";
import { useRecordExport } from "~/components/activities";
import { AnimatedOutlet, ReviewProvider } from "~/components/flow";
import { StageBar, type Stage } from "~/components/ui";
import { programOf } from "~/lib/activities.server";
import { reviewSurveyFrame } from "~/lib/data.server";
import { surveyForProgram } from "~/lib/workspace.server";
import type { Route } from "./+types/review";

const STAGE_LIST = [
  { key: "explore", label: "Explore" },
  { key: "diagnose", label: "Diagnose" },
  { key: "build", label: "Build changes" },
  { key: "packet", label: "Board packet" },
];
const stagesFor = (base: string): Stage[] => STAGE_LIST.map((s) => ({ ...s, to: `${base}/${s.key}` }));

// The header (program, audience sizes, surveys) doesn't change between stages.
export const shouldRevalidate = ({ formMethod, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) => (formMethod ? defaultShouldRevalidate : false);

/**
 * Survey audience sizes (employers on record, alumni reachable by email) come from Postgres, and so does
 * whether this program's surveys are out (Surveys API). Response counts are SIMULATED and labelled "demo";
 * the per-stage `demo` tallies feed the diagnose and packet quotes.
 */
export async function loader({ params }: Route.LoaderArgs) {
  const programId = await programOf(params);
  const [frame, surveys] = await Promise.all([reviewSurveyFrame(programId), surveyForProgram(programId)]);
  const e = frame.employers;
  const a = frame.reachable;
  const at = (fe: number, fa: number) => ({ employers: Math.min(e, Math.round(e * fe)), alumni: Math.round(a * fa) });
  const out = (s: (typeof surveys)["alumni"]) => (s && s.status === "sent" ? { id: s.id, threadId: s.threadId, recipients: s.recipients, responses: s.demo?.responses ?? 0 } : null);
  return {
    frame,
    surveys: { alumni: out(surveys.alumni), employers: out(surveys.employers) },
    demo: { explore: at(0.35, 0.24), diagnose: at(0.6, 0.5), build: at(0.85, 0.66), packet: at(0.9, 0.72) },
  };
}

export type ReviewLayoutData = Awaited<ReturnType<typeof loader>>;

type Config = {
  current: number;
  progress: number;
  cta: { label: string; to: string; tone?: "ink" | "red"; form?: string };
};

/** Every CTA goes straight to the next stage; the stage pills stay freely navigable. */
function config(key: string, base: string): Config {
  switch (key) {
    case "diagnose":
      return { current: 1, progress: 0.5, cta: { label: "Continue to Build changes →", to: `${base}/build` } };
    case "build":
      return { current: 2, progress: 0.5, cta: { label: "Continue to Board packet →", to: `${base}/packet`, tone: "red" } };
    case "packet":
      return { current: 3, progress: 1, cta: { label: "Export packet · PDF", to: "#print", tone: "red" } };
    default:
      return { current: 0, progress: 0.5, cta: { label: "Continue to Diagnose →", to: `${base}/diagnose` } };
  }
}

/** The surveys chip: real send state; answer counts are simulated (demo). */
function surveyChip(d: ReviewLayoutData) {
  const { alumni, employers } = d.surveys;
  if (!alumni && !employers) return { text: "No surveys out for this program", tone: "muted" as const };
  const parts = [employers && `${employers.responses}/${employers.recipients} employers`, alumni && `${alumni.responses}/${alumni.recipients} alumni`].filter(Boolean);
  return { text: `Surveys live · ${parts.join(" · ")} answered · demo`, tone: "red" as const };
}

export default function ReviewLayout() {
  const d = useLoaderData<typeof loader>();
  const { pathname } = useLocation();
  const { activityId } = useParams();
  const base = `/a/${activityId}/review`;
  const key = pathname.split("/")[4] || "explore";
  const c = config(key, base);
  const recordExport = useRecordExport();
  // Expose the sticky stage bar's height as --stagebar-h so side panels can pin themselves just below it.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    const bar = el?.firstElementChild as HTMLElement | null;
    if (!el || !bar) return;
    const set = () => el.style.setProperty("--stagebar-h", `${bar.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);
  return (
    <ReviewProvider>
      <div ref={root} className={key === "packet" ? "flex min-h-screen flex-col bg-surface [--stagebar-h:113px]" : "flex min-h-screen flex-col [--stagebar-h:113px]"}>
        <StageBar
          title={d.frame.program}
          subtitle="Program review · due to board Dec 12"
          stages={stagesFor(base)}
          current={c.current}
          progress={c.progress}
          chip={surveyChip(d)}
          cta={
            c.cta.to === "#print"
              ? {
                  ...c.cta,
                  to: "",
                  onClick: () => {
                    // Record the export first (a fetcher POST), then open the print dialog.
                    recordExport({ format: "pdf", artifact: "board-packet", label: `${d.frame.program} · board packet` });
                    window.print();
                  },
                }
              : c.cta
          }
        />
        <AnimatedOutlet className="flex grow flex-col" />
      </div>
    </ReviewProvider>
  );
}
