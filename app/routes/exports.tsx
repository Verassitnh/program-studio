import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Form, Link, data, useFetcher, useNavigate, useSearchParams } from "react-router";
import { Button, Item, Stagger, cx, ease } from "~/components/ui";
import {
  ActionButton,
  Empty,
  Kpi,
  KpiStrip,
  PanelHeader,
  Pill,
  SectionHead,
  Segmented,
  SlideOver,
  SmallN,
  StatusLine,
  Th,
  TopBar,
  fieldCls,
  rowClick,
  useHrefWith,
  useLatest,
} from "~/components/workspace/kit";
import { fmtDateTime, fmtNum, shortProgram } from "~/components/workspace/model";
import { exportsPage, recordQuickExport } from "~/lib/workspace.server";
import type { Route } from "./+types/exports";

export const meta: Route.MetaFunction = () => [{ title: "Exports · Program Studio · Lightcast" }];

export const loader = ({ request }: Route.LoaderArgs) => exportsPage(request);

export async function action({ request }: Route.ActionArgs) {
  const fd = await request.formData();
  const res = await recordQuickExport(String(fd.get("programId") ?? ""), String(fd.get("kind") ?? ""));
  return data(res, { status: res.ok ? 200 : 400 });
}

type LoaderData = Route.ComponentProps["loaderData"];
type Row = LoaderData["rows"][number] & { pending?: boolean };
type QuickResult = { ok: true; id: number; href: string; filename: string; rows: number } | { ok: false; error: string };

const STATUS_TONE: Record<string, "red" | "ink" | "solid" | "muted" | "dashed"> = {
  collecting: "muted",
  in_progress: "red",
  exported: "ink",
  completed: "solid",
  closed_early: "dashed",
};
const FORMAT_LABEL: Record<string, string> = { pdf: "PDF", csv: "CSV", print: "Print" };
const QUICK_KINDS = [
  { id: "outcomes", label: "Outcomes claims", sub: "Every outcome figure with its count, n, small-sample flag and source file" },
  { id: "alignment", label: "Alignment and skill coverage", sub: "Each target occupation's alignment score, then every benchmark skill and whether the program teaches it" },
] as const;

export default function Exports({ loaderData: d }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const hrefWith = useHrefWith();
  const quick = useFetcher<QuickResult>({ key: "quick-export" });
  const source = params.get("source") ?? "";
  const format = params.get("format") ?? "";
  const selectedKey = params.get("x");

  // Optimistic: a pending quick export shows as a row at once.
  const rows: Row[] = useMemo(() => {
    const fd = quick.formData;
    if (!fd) return d.rows;
    const p = d.programs.find((x) => x.id === fd.get("programId"));
    const kind = QUICK_KINDS.find((k) => k.id === fd.get("kind"));
    if (!p || !kind) return d.rows;
    const ghost: Row = {
      key: "pending",
      source: "quick",
      at: new Date().toISOString(),
      programId: p.id,
      programName: p.name,
      kind: kind.label,
      format: "csv",
      artifact: "Preparing…",
      label: `${kind.label} · quick export`,
      activity: null,
      openHref: null,
      downloadHref: null,
      pending: true,
    };
    return [ghost, ...d.rows];
  }, [d.rows, d.programs, quick.formData, quick.state]);

  const shown = rows.filter((r) => (!source || r.source === source) && (!format || r.format === format));
  const formats = [...new Set(rows.map((r) => r.format))];
  const selected = useLatest(rows.find((r) => r.key === selectedKey && !r.pending));
  const close = () => navigate(hrefWith({ x: null }), { preventScrollReset: true });

  return (
    <>
      <div data-ws-page className="flex min-h-screen flex-col">
        <TopBar trail="Exports" />
        <Stagger className="flex grow flex-col gap-10 px-10 pb-12 pt-10">
          <Item className="flex flex-col gap-2">
            <h1 className="text-4xl font-semibold leading-10 tracking-[-0.03em] text-ink">Exports</h1>
            <p className="text-[15px] leading-[22px] text-subtle">Every board packet and outcomes file you've produced, ready to open or download again.</p>
          </Item>

          <KpiStrip label="Export summary">
            <Kpi label="Exports" value={d.kpis.total} sub="Packets, stories and CSVs" />
            <Kpi label="Board packets" value={d.kpis.packets} sub="From Program reviews" />
            <Kpi label="CSV files" value={d.kpis.csv} sub="Activity and quick exports" />
            <Kpi label="Programs covered" value={d.kpis.programs} sub={`of ${d.programs.length} School of Business programs`} />
            <Kpi label="Last export" value={d.kpis.last ? fmtDateTime(d.kpis.last) : "—"} sub={d.kpis.last ? "Pacific time" : "Nothing exported yet"} />
          </KpiStrip>

          <Item as="section" className="flex flex-col gap-4">
            <SectionHead id="library" title="Library" sub="Activity exports are recorded when a packet is printed or a story or CSV is exported. Quick exports are recorded when downloaded below." />
            {rows.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Segmented
                  label="Filter by source"
                  param="source"
                  value={source}
                  options={[
                    { value: "", label: "All", count: rows.length },
                    { value: "activity", label: "From activities", count: rows.filter((r) => r.source === "activity").length },
                    { value: "quick", label: "Quick exports", count: rows.filter((r) => r.source === "quick").length },
                  ]}
                />
                <Segmented label="Filter by format" param="format" value={format} options={[{ value: "", label: "Any format" }, ...formats.map((f) => ({ value: f, label: FORMAT_LABEL[f] ?? f }))]} />
              </div>
            )}
            {rows.length === 0 ? (
              <Empty
                title="Nothing exported yet"
                action={
                  d.canStart ? (
                    <Form method="post" action="/activities/new">
                      <input type="hidden" name="programId" value="program-north-sound-state-business-bachelor" />
                      <input type="hidden" name="kind" value="review" />
                      <ActionButton tone="ink" size="md">
                        Start a Program review
                      </ActionButton>
                    </Form>
                  ) : (
                    <Button tone="ink" to="/">
                      Go to Programs
                    </Button>
                  )
                }
              >
                Board packets appear here when you export them from a Program review. Outcomes stories and CSVs appear when exported from an Outcomes story, or when you
                download one with Quick export below.
                {!d.activitiesAvailable && " Activity exports will show once activities are set up on this server."}
              </Empty>
            ) : shown.length === 0 ? (
              <Empty title="No exports match these filters" action={<Button tone="outline" to="?">Clear filters</Button>}>
                Try another source or format.
              </Empty>
            ) : (
              <ExportTable rows={shown} selectedKey={selectedKey} />
            )}
          </Item>

          <Item as="section" className="flex flex-col gap-4">
            <SectionHead id="quick" title="Quick export" sub="Download a CSV for any School of Business program without starting an activity. Every value is counted from the records; nothing is simulated." />
            <QuickExport programs={d.programs} smallN={d.settings.smallN} regionName={d.settings.regionName} fetcher={quick} />
          </Item>
        </Stagger>
      </div>

      <SlideOver open={!!selectedKey && !!rows.find((r) => r.key === selectedKey)} onClose={close} labelledBy="export-title" returnFocus={selected ? `[data-row-link="${selected.key}"]` : null}>
        {selected && <ExportPanel r={selected} onClose={close} />}
      </SlideOver>
    </>
  );
}

function ExportTable({ rows, selectedKey }: { rows: Row[]; selectedKey: string | null }) {
  const navigate = useNavigate();
  const hrefWith = useHrefWith();
  return (
    <table className="w-full border-collapse text-left">
      <caption className="sr-only">Exports, newest first. Select one to open, download or copy its link.</caption>
      <thead>
        <tr>
          <Th className="w-[28%]">Export</Th>
          <Th>Program</Th>
          <Th>Format</Th>
          <Th>Exported</Th>
          <Th>From</Th>
          <Th>Activity status</Th>
        </tr>
      </thead>
      <tbody>
        <AnimatePresence initial={false}>
          {rows.map((r) => {
            const href = hrefWith({ x: r.key });
            const on = r.key === selectedKey;
            return (
              <motion.tr
                key={r.key}
                layout="position"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: r.pending ? 0.6 : 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.15, ease: "easeOut" } }}
                transition={{ duration: 0.3, ease }}
                onClick={r.pending ? undefined : rowClick(href, navigate)}
                className={cx("h-16 border-b border-line transition-colors duration-150", r.pending ? "cursor-progress" : "cursor-pointer hover:bg-row-hover", on && "bg-surface hover:bg-surface")}
              >
                <th scope="row" className="py-3 pr-3 text-left font-normal">
                  {r.pending ? (
                    <span className="flex flex-col gap-0.5">
                      <span className="text-[15px] font-medium text-ink">{r.kind}</span>
                      <span className="text-xs text-muted">Preparing download…</span>
                    </span>
                  ) : (
                    <Link to={href} preventScrollReset data-row-link={r.key} aria-current={on ? "true" : undefined} className="flex flex-col gap-0.5 rounded-sm">
                      <span className="truncate text-[15px] font-medium text-ink">{r.kind}</span>
                      <span className="truncate font-mono text-[11px] text-muted">{r.artifact}</span>
                    </Link>
                  )}
                </th>
                <td className="px-3 text-[13px] text-text">{shortProgram(r.programName)}</td>
                <td className="px-3">
                  <span className="label rounded-md bg-surface px-1.5 py-1 text-[10px] text-ink">{FORMAT_LABEL[r.format] ?? r.format}</span>
                </td>
                <td className="px-3 font-mono text-[13px] tabular-nums text-subtle">{fmtDateTime(r.at)}</td>
                <td className="px-3 text-[13px]">
                  {r.activity ? (
                    <Link to={r.activity.href} className="text-ink underline decoration-line-hover decoration-1 underline-offset-[3px] hover:decoration-ink">
                      {r.activity.title}
                    </Link>
                  ) : (
                    <span className="text-subtle">Quick export</span>
                  )}
                </td>
                <td className="pl-3">{r.activity ? <Pill tone={STATUS_TONE[r.activity.status.key] ?? "muted"}>{r.activity.status.label}</Pill> : <span className="text-xs text-muted">No activity</span>}</td>
              </motion.tr>
            );
          })}
        </AnimatePresence>
      </tbody>
    </table>
  );
}

function useCopy() {
  const [state, setState] = useState<"idle" | "ok" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (path: string) => {
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
      setState("ok");
    } catch {
      setState("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 4000);
  };
  return { state, copy };
}

function ExportPanel({ r, onClose }: { r: Row; onClose: () => void }) {
  const { state, copy } = useCopy();
  const link = r.openHref ?? r.downloadHref ?? "/exports";
  return (
    <>
      <PanelHeader id="export-title" eyebrow={`${FORMAT_LABEL[r.format] ?? r.format} · ${r.source === "quick" ? "Quick export" : "Activity export"}`} title={r.label} onClose={onClose} closeLabel="Close export details">
        <div className="flex flex-wrap items-center gap-2">
          {r.openHref && (
            <Button tone="ink" size="sm" to={r.openHref}>
              Open in activity
            </Button>
          )}
          {r.downloadHref && (
            <a href={r.downloadHref} download className="inline-flex h-[30px] items-center rounded-full border border-line px-3.5 text-xs font-medium text-ink transition-[border-color,scale] duration-150 hover:border-ink active:scale-[0.96]">
              Download again
            </a>
          )}
          <ActionButton type="button" onClick={() => copy(link)}>
            {state === "ok" ? "Link copied" : "Copy link"}
          </ActionButton>
        </div>
        <StatusLine message={state === "ok" ? "Link copied to the clipboard." : undefined} />
        <StatusLine tone="error" message={state === "failed" ? "Unable to copy. Select the link below and copy it." : undefined} />
      </PanelHeader>
      <div className="flex flex-col gap-7 px-7 py-6">
        <dl className="flex flex-col border-t border-line text-[13px]">
          {(
            [
              ["Program", r.programName],
              ["What", r.kind],
              ["File or artifact", r.artifact],
              ["Exported", `${fmtDateTime(r.at)} PT`],
              ["Link", new URL(link, "http://localhost").pathname],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-6 border-b border-line py-2.5">
              <dt className="shrink-0 text-subtle">{k}</dt>
              <dd className={cx("min-w-0 text-right text-ink [overflow-wrap:anywhere]", (k === "Link" || k === "File or artifact") && "font-mono text-xs")}>{v}</dd>
            </div>
          ))}
        </dl>
        {r.activity ? (
          <section aria-labelledby="ex-activity" className="flex flex-col gap-2.5 rounded-2xl bg-surface p-4">
            <h3 id="ex-activity" className="label text-muted">
              Activity
            </h3>
            <div className="flex items-center justify-between gap-3">
              <Link to={r.activity.href} className="text-[15px] font-medium text-ink underline decoration-line-hover underline-offset-[3px] hover:decoration-ink">
                {r.activity.title}
              </Link>
              <Pill tone={STATUS_TONE[r.activity.status.key] ?? "muted"}>{r.activity.status.label}</Pill>
            </div>
            <p className="text-xs leading-[17px] text-subtle">{r.activity.kind === "review" ? "Opens the board packet stage." : "Opens the export stage of the outcomes story."}</p>
          </section>
        ) : (
          <p className="text-xs leading-[17px] text-muted">Quick exports aren't tied to an activity. Download again rebuilds the file from the current data, so numbers update after a sync.</p>
        )}
      </div>
    </>
  );
}

function QuickExport({ programs, smallN, regionName, fetcher }: { programs: LoaderData["programs"]; smallN: number; regionName: string; fetcher: ReturnType<typeof useFetcher<QuickResult>> }) {
  const [programId, setProgramId] = useState(programs[0]?.id ?? "");
  const [kind, setKind] = useState<string>("outcomes");
  const ids = { program: useId() };
  const p = programs.find((x) => x.id === programId);
  const pending = fetcher.state !== "idle";
  const done = useRef<number | null>(null);
  useEffect(() => {
    const r = fetcher.data;
    if (fetcher.state !== "idle" || !r?.ok || done.current === r.id) return;
    done.current = r.id;
    const a = document.createElement("a");
    a.href = r.href;
    a.download = r.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [fetcher.state, fetcher.data]);
  const result = fetcher.data;
  return (
    <fetcher.Form method="post" className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-end gap-5 rounded-2xl border border-line p-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.program} className="text-[13px] font-medium text-ink">
          Program
        </label>
        <select id={ids.program} name="programId" value={programId} onChange={(e) => setProgramId(e.target.value)} className={fieldCls}>
          {programs.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <div className="flex min-h-4 items-center gap-2 text-xs text-subtle">
          {p && (
            <>
              {fmtNum(p.alumni)} alumni · {fmtNum(p.matched)} with a known job <SmallN n={p.matched} min={smallN} />
            </>
          )}
        </div>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-[13px] font-medium text-ink">File</legend>
        <div className="flex gap-2">
          {QUICK_KINDS.map((k) => (
            <label
              key={k.id}
              className={cx(
                "flex flex-1 cursor-pointer flex-col gap-0.5 rounded-xl border px-3 py-2 transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink",
                kind === k.id ? "border-ink" : "border-line hover:border-line-hover",
              )}
            >
              <span className="flex items-center gap-2 text-[13px] font-medium text-ink">
                <input type="radio" name="kind" value={k.id} checked={kind === k.id} onChange={() => setKind(k.id)} className="accent-ink" />
                {k.label}
              </span>
              <span className="pl-5 text-[11px] leading-[15px] text-subtle">
                {k.sub}
                {k.id === "alignment" && ` (${regionName}, 2024)`}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col items-end gap-1.5">
        <ActionButton tone="ink" size="md" pending={pending} pendingLabel="Preparing…">
          Download CSV
        </ActionButton>
        <div className="min-h-4" />
      </div>
      <div className="col-span-3">
        <StatusLine message={result?.ok && !pending ? `Downloaded ${result.filename} (${fmtNum(result.rows)} rows). It's listed in the library above.` : undefined} />
        <StatusLine tone="error" message={result && !result.ok ? result.error : undefined} />
      </div>
    </fetcher.Form>
  );
}
