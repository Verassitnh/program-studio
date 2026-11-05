import { useLocation, useParams, useSearchParams, type ShouldRevalidateFunctionArgs } from "react-router";
import { FIX_DEFAULT, useActivityState, useRecordExport, type FixState } from "~/components/activities";
import { AnimatedOutlet } from "~/components/flow";
import { StageBar, type Stage } from "~/components/ui";
import { programOf } from "~/lib/activities.server";
import { outcomesHeader } from "~/lib/data.server";
import type { Route } from "./+types/outcomes";

export const loader = async ({ params }: Route.LoaderArgs) => outcomesHeader(await programOf(params));

// Header counts don't change between stages or tabs.
export const shouldRevalidate = ({ formMethod, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) => (formMethod ? defaultShouldRevalidate : false);

/** Opens on the report itself (Story); the program was picked on Programs, so there's no scan step. */
const STAGE_LIST = [
  { key: "story", label: "Story" },
  { key: "deeper", label: "Dig deeper" },
  { key: "fix", label: "Fix the story" },
  { key: "export", label: "Export" },
];
const stagesFor = (base: string): Stage[] => STAGE_LIST.map((s) => ({ ...s, to: `${base}/${s.key}` }));

const TABS = ["pay", "slow", "unknown"] as const;
const TAB_LABEL = { pay: "Pay", slow: "Slow hires", unknown: "Unknown outcomes" };

/** Page titles name the stage (and weak spot) first, so tabs and history entries are distinguishable. */
export const meta: Route.MetaFunction = ({ location, loaderData }) => {
  const key = location.pathname.split("/")[4] || "story";
  const stage = STAGE_LIST.find((s) => s.key === key)?.label ?? "Story";
  const tab = key === "deeper" ? TABS.find((t) => t === new URLSearchParams(location.search).get("tab")) ?? "pay" : null;
  return [{ title: [stage, tab && TAB_LABEL[tab], loaderData?.program.name, "Outcomes story", "Program Studio"].filter(Boolean).join(" · ") }];
};

type Cta = { label: string; to: string; tone?: "ink" | "red" };
type Config = { current: number; progress: number; title: string; subtitle: string; cta: Cta };

export default function OutcomesLayout({ loaderData: h }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const { activityId } = useParams();
  const base = `/a/${activityId}/outcomes`;
  const STAGES = stagesFor(base);
  const key = pathname.split("/")[4] || "story";
  const tab = TABS.find((t) => t === params.get("tab")) ?? "pay";
  const program = h.program.name;
  const recordExport = useRecordExport();
  const [fix] = useActivityState<FixState>("fix", FIX_DEFAULT);
  const fixesApplied = Number(fix.pay) + Number(fix.slow);

  const config: Record<string, Config> = {
    story: { current: 0, progress: 0.5, title: program, subtitle: h.alumni ? `${h.alumni} alumni · ${h.matched} with a known job` : "No alumni records yet", cta: { label: "Continue to Dig deeper →", to: `${base}/deeper` } },
    deeper: {
      current: 1,
      // Tabs are optional reading: the bar doesn't fill per tab, and the CTA moves on from any of them.
      progress: 0.5,
      title: program,
      subtitle: `${TABS.length} weak spots · viewing ${TAB_LABEL[tab]}`,
      cta: { label: "Continue to Fix the story →", to: `${base}/fix` },
    },
    fix: { current: 2, progress: 0.5, title: program, subtitle: `${fixesApplied} fix${fixesApplied === 1 ? "" : "es"} applied · 2 in progress`, cta: { label: "Continue to Export →", to: `${base}/export` } },
    export: { current: 3, progress: 1, title: program, subtitle: "Outcomes story · ready to export", cta: { label: "Export story ↓", to: "#print", tone: "red" } },
  };
  const c = config[key] ?? config.story;

  return (
    <div className="flex min-h-screen flex-col">
      <StageBar
        title={c.title}
        subtitle={c.subtitle}
        stages={STAGES}
        current={c.current}
        progress={c.progress}
        cta={
          c.cta.to === "#print"
            ? {
                ...c.cta,
                to: "",
                onClick: () => {
                  recordExport({ format: "pdf", artifact: "outcomes-story", label: `${program} outcomes story` });
                  window.print();
                },
              }
            : c.cta
        }
      />
      <AnimatedOutlet className="flex grow flex-col" />
    </div>
  );
}
