import { AnimatePresence, motion } from "motion/react";
import { useId, useState } from "react";
import { Link, data, useFetcher, useNavigate, useSearchParams } from "react-router";
import { Item, Stagger, Toggle, cx, ease } from "~/components/ui";
import {
  ActionButton,
  DemoTag,
  Empty,
  Kpi,
  KpiStrip,
  PanelHeader,
  Pill,
  SectionHead,
  Segmented,
  SlideOver,
  StatusLine,
  Th,
  TopBar,
  rowClick,
  useHrefWith,
  useLatest,
} from "~/components/workspace/kit";
import { CONNECTORS, fmtDateTime, fmtNum, plural } from "~/components/workspace/model";
import { integrationsPage, setSimulatedConnection } from "~/lib/workspace.server";
import type { Route } from "./+types/integrations";

export const meta: Route.MetaFunction = () => [{ title: "Integrations · Program Studio · Lightcast" }];

export const loader = ({ request }: Route.LoaderArgs) => integrationsPage(request);

export async function action({ request }: Route.ActionArgs) {
  const fd = await request.formData();
  const key = String(fd.get("key") ?? "");
  const intent = String(fd.get("intent") ?? "");
  const c = CONNECTORS.find((x) => x.key === key);
  if (!c || (intent !== "connect" && intent !== "disconnect")) return data({ ok: false, error: "Unknown connector." }, { status: 400 });
  await setSimulatedConnection(key, intent === "connect");
  return { ok: true, message: intent === "connect" ? `${c.name} marked as connected (simulated). No data flows.` : `${c.name} disconnected.` };
}

type LoaderData = Route.ComponentProps["loaderData"];
type SyncResult = { sync?: { id: number; activity_id?: string | null; changed_programs?: unknown[]; closed?: unknown[]; flagged?: unknown[] }; error?: string };

const KIND_LABEL: Record<string, string> = { "source-data": "Source", "derived-data": "Derived", "shared-value": "Reference", catalog: "Catalog" };

export default function Integrations({ loaderData: d }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const hrefWith = useHrefWith();
  const connectorKey = params.get("c");
  const syncId = Number(params.get("sync")) || null;
  const connector = useLatest(CONNECTORS.find((c) => c.key === connectorKey));
  const syncRow = useLatest(d.history.rows.find((r) => r.id === syncId));
  const records = d.datasets.reduce((s, r) => s + r.records, 0);
  const attention = d.health.checks.filter((c) => !c.ok).length;
  const simulated = Object.values(d.connections).filter((c) => c.connected).length;
  const closeWith = (k: string) => () => navigate(hrefWith({ [k]: null }), { preventScrollReset: true });

  return (
    <>
      <div data-ws-page className="flex min-h-screen flex-col">
        <TopBar trail="Integrations" />
        <Stagger className="flex grow flex-col gap-10 px-10 pb-12 pt-10">
          <Item className="flex flex-col gap-2">
            <h1 className="text-4xl font-semibold leading-10 tracking-[-0.03em] text-ink">Integrations</h1>
            <p className="text-[15px] leading-[22px] text-subtle">Where Program Studio's data comes from, how fresh it is, and what still needs fixing.</p>
          </Item>

          <KpiStrip label="Integration summary">
            <Kpi label="Datasets" value={d.datasets.length} sub="Lightcast data products, loaded locally" />
            <Kpi label="Records" value={records} sub="Rows across every raw dataset" />
            <Kpi label="Last sync" value={d.lastSync ? fmtDateTime(d.lastSync) : d.importedAt ? fmtDateTime(d.importedAt) : "—"} sub={d.lastSync ? "Pacific time" : "Import time (no syncs yet)"} />
            <Kpi label="Syncs run" value={d.history.total} sub={d.history.available ? "Recorded in sync history" : "Sync history not set up yet"} />
            <Kpi label="Data checks to review" value={attention} tone={attention ? "red" : undefined} sub={`of ${d.health.checks.length} checks below`} />
          </KpiStrip>

          <Item as="section" className="flex flex-col gap-4" >
            <SectionHead id="lightcast" title="Connected source" sub="The only live source in this prototype. Syncing re-reads the local files and checks every open activity against the new data." />
            <LightcastCard d={d} records={records} />
          </Item>

          <Item as="section" className="flex flex-col gap-4">
            <SectionHead id="history" title="Sync history" sub="Each sync compares every open activity's data with what it started from. Changed and fully corrected: closed. Changed with issues left: flagged." />
            {!d.history.available ? (
              <Empty title="Sync history isn't set up yet">The sync service hasn't created its history table. Run a sync, or `npm run db:import`, to start recording.</Empty>
            ) : d.history.rows.length === 0 ? (
              <Empty title="No syncs yet">Use Sync now above. Each run appears here with the programs it changed and the activities it closed or flagged.</Empty>
            ) : (
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">Sync history, newest first. Select a sync to see its details.</caption>
                <thead>
                  <tr>
                    <Th>Ran at</Th>
                    <Th>Source</Th>
                    <Th>Corrections</Th>
                    <Th>Programs changed</Th>
                    <Th>Activities closed</Th>
                    <Th>Activities flagged</Th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {d.history.rows.map((r) => {
                      const href = hrefWith({ sync: String(r.id), c: null });
                      const on = r.id === syncId;
                      return (
                        <motion.tr
                          key={r.id}
                          layout="position"
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.3, ease }}
                          onClick={rowClick(href, navigate)}
                          className={cx("h-14 cursor-pointer border-b border-line transition-colors duration-150 hover:bg-row-hover", on && "bg-surface hover:bg-surface")}
                        >
                          <th scope="row" className="pr-3 text-left font-normal">
                            <Link to={href} preventScrollReset data-row-link={`sync-${r.id}`} aria-current={on ? "true" : undefined} className="font-mono text-[13px] tabular-nums text-ink">
                              {fmtDateTime(r.ranAt)} <span className="text-muted">#{r.id}</span>
                            </Link>
                          </th>
                          <td className="px-3 text-[13px] text-subtle">{r.source}</td>
                          <td className="px-3">{r.demo ? <DemoTag>Demo corrections</DemoTag> : <span className="text-[13px] text-muted">None</span>}</td>
                          <td className="px-3 text-[13px] text-text">{r.changed.length ? r.changed.map((p) => p.label).join(", ") : <span className="text-muted">None</span>}</td>
                          <td className="px-3 text-[13px]">
                            <RefList refs={r.closed} />
                          </td>
                          <td className="pl-3 text-[13px]">
                            <RefList refs={r.flagged} />
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
            )}
          </Item>

          <Item as="section" className="flex flex-col gap-4">
            <SectionHead id="health" title="Data health" sub={`Checks run on the ${fmtNum(d.health.alumni)} NSSU alumni records as they are now.`} />
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {d.health.checks.map((c) => (
                <div key={c.key} className="flex flex-col gap-2 rounded-xl border border-line p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[13px] font-medium text-ink">{c.label}</h3>
                    {c.ok ? (
                      <span className="text-xs text-ink">
                        <span aria-hidden>✓ </span>OK
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-red">Review</span>
                    )}
                  </div>
                  <div className={cx("text-xl font-semibold tabular-nums tracking-[-0.01em]", c.ok ? "text-ink" : "text-red")}>{c.value}</div>
                  <p className="text-xs leading-[17px] text-pretty text-subtle">{c.detail}</p>
                  {c.href && (
                    <Link to={c.href} className="mt-auto text-xs font-medium text-ink underline decoration-1 underline-offset-[3px]">
                      {c.cta}
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </Item>

          <Item as="section" className="flex flex-col gap-4">
            <SectionHead
              id="connectors"
              title="Other connectors"
              sub={
                <>
                  Systems a school would connect next. None is wired up in this prototype{simulated ? `; ${plural(simulated, "is", "are")} marked connected as a simulation` : ""}.
                </>
              }
            />
            <ul className="grid grid-cols-3 gap-3">
              {CONNECTORS.map((c, i) => {
                const conn = d.connections[c.key]?.connected;
                return (
                  <motion.li key={c.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.04, duration: 0.4, ease }}>
                    <Link
                      to={hrefWith({ c: c.key, sync: null })}
                      preventScrollReset
                      data-row-link={`c-${c.key}`}
                      aria-current={connectorKey === c.key ? "true" : undefined}
                      className={cx(
                        "group flex items-center gap-3 rounded-xl border bg-white px-3.5 py-3 transition-[border-color,translate] duration-150 hover:-translate-y-px",
                        conn ? "border-dashed border-ink" : "border-line hover:border-subtle",
                      )}
                    >
                      <span aria-hidden className={cx("flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg text-xs font-semibold", conn ? "bg-ink text-white" : "bg-surface text-subtle")}>
                        {c.letter}
                      </span>
                      <span className="flex min-w-0 grow flex-col">
                        <span className="truncate text-[13px] font-medium text-ink">{c.name}</span>
                        <span className="truncate text-[11px] text-subtle">{conn ? "Simulated connection · no data flows" : `${c.category} · Not connected`}</span>
                      </span>
                      <span className="shrink-0 text-xs text-subtle transition-colors group-hover:text-ink">{conn ? "Details" : "Connect"}</span>
                    </Link>
                  </motion.li>
                );
              })}
            </ul>
          </Item>
        </Stagger>
      </div>

      <SlideOver open={!!connectorKey && !!CONNECTORS.find((c) => c.key === connectorKey)} onClose={closeWith("c")} labelledBy="connector-title" returnFocus={connector ? `[data-row-link="c-${connector.key}"]` : null}>
        {connector && <ConnectorPanel c={connector} state={d.connections[connector.key]} onClose={closeWith("c")} />}
      </SlideOver>
      <SlideOver open={!!syncId && !!d.history.rows.find((r) => r.id === syncId)} onClose={closeWith("sync")} labelledBy="sync-title" returnFocus={syncRow ? `[data-row-link="sync-${syncRow.id}"]` : null}>
        {syncRow && <SyncPanel s={syncRow} onClose={closeWith("sync")} />}
      </SlideOver>
    </>
  );
}

function RefList({ refs }: { refs: LoaderData["history"]["rows"][number]["closed"] }) {
  if (!refs.length) return <span className="text-muted">None</span>;
  return (
    <ul className="flex flex-col gap-0.5">
      {refs.map((r) => (
        <li key={r.id}>
          {r.href ? (
            <Link to={r.href} className="text-ink underline decoration-line-hover decoration-1 underline-offset-[3px] hover:decoration-ink">
              {r.label}
            </Link>
          ) : (
            <span className="text-text">{r.label}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------ Lightcast card */

function LightcastCard({ d, records }: { d: LoaderData; records: number }) {
  const sync = useFetcher<SyncResult>({ key: "sync-now" });
  const [demo, setDemo] = useState(false);
  const [all, setAll] = useState(false);
  const [params] = useSearchParams();
  const kind = params.get("kind") ?? "";
  const toggleId = useId();
  const listId = useId();
  const pending = sync.state !== "idle";
  const [localError, setLocalError] = useState<string | null>(null);
  const res = sync.data;
  const result = res?.sync
    ? `Sync #${res.sync.id} finished: ${plural(res.sync.changed_programs?.length ?? 0, "program", "programs")} changed, ${plural(res.sync.closed?.length ?? 0, "activity", "activities")} closed, ${plural(res.sync.flagged?.length ?? 0, "activity", "activities")} flagged.`
    : null;
  const error = localError ?? res?.error ?? null;
  const rows = d.datasets.filter((r) => !kind || r.kind === kind);
  const visible = all ? rows : rows.slice(0, 8);

  return (
    <div className="flex flex-col rounded-2xl border border-line">
      <div className="flex flex-wrap items-center gap-5 border-b border-line px-5 py-4">
        <div aria-hidden className="h-9 w-9 shrink-0 rounded-[10px] bg-red" />
        <div className="flex min-w-0 grow flex-col gap-0.5">
          <div className="flex items-center gap-2.5">
            <h3 className="text-[15px] font-semibold text-ink">Lightcast data products (local import)</h3>
            <Pill tone="ink">Connected</Pill>
          </div>
          <p className="text-[13px] text-subtle">
            {fmtNum(d.datasets.length)} datasets · {fmtNum(records)} records ·{" "}
            {d.lastSync ? <>last sync {fmtDateTime(d.lastSync)} PT</> : d.importedAt ? <>imported about {fmtDateTime(d.importedAt)} PT</> : "import time unknown"}
          </p>
        </div>
        <sync.Form
          method="post"
          action="/api/sync"
          className="flex items-center gap-4"
          onSubmit={(e) => {
            setLocalError(null);
            if (!d.syncAvailable) {
              e.preventDefault();
              setLocalError("The sync service isn't available on this server yet. Try again after the next deploy.");
            }
          }}
        >
          <input type="hidden" name="source" value="integrations" />
          {demo && <input type="hidden" name="demoCorrections" value="1" />}
          <div className="flex items-center gap-2.5">
            <Toggle on={demo} onChange={setDemo} size="sm" label="Include demo corrections (simulated)" />
            <span id={toggleId} aria-hidden className="text-[13px] text-text">
              Include demo corrections <span className="text-muted">(simulated)</span>
            </span>
          </div>
          <ActionButton tone="ink" size="md" pending={pending} pendingLabel="Syncing…">
            Sync now
          </ActionButton>
        </sync.Form>
      </div>
      <div className="flex flex-col gap-1 border-b border-line bg-surface/60 px-5 py-3 text-xs leading-[17px] text-subtle">
        <p>
          The example data is static, so a plain sync re-reads the same files and changes nothing. Turn on demo corrections to apply a small set of simulated fixes (for
          example, newly matched jobs) so you can see activities close or get flagged.
        </p>
        <StatusLine message={pending ? "Syncing: re-importing the data and checking open activities…" : result} />
        {/* Every sync run is an activity (a sidebar thread) with its own results page. */}
        {!pending && res?.sync?.activity_id && (
          <Link to={`/a/${res.sync.activity_id}/sync`} className="w-fit font-medium text-ink underline underline-offset-4 hover:text-red-deep">
            Open the sync activity →
          </Link>
        )}
        <Link to="/onboarding" className="w-fit text-subtle underline underline-offset-4 hover:text-ink">
          Re-run setup (connect, sync, surveys)
        </Link>
        <StatusLine tone="error" message={!pending ? error : null} />
      </div>
      <div className="flex flex-col gap-3 px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <h4 className="label text-muted">Datasets</h4>
          <Segmented
            label="Filter datasets by type"
            param="kind"
            value={kind}
            options={[
              { value: "", label: "All", count: d.datasets.length },
              { value: "source-data", label: "Source", count: d.datasets.filter((r) => r.kind === "source-data").length },
              { value: "derived-data", label: "Derived", count: d.datasets.filter((r) => r.kind === "derived-data").length },
            ]}
          />
        </div>
        <table id={listId} className="w-full border-collapse text-left">
          <caption className="sr-only">Datasets in the local import, largest first</caption>
          <thead>
            <tr>
              <Th>Dataset</Th>
              <Th>File</Th>
              <Th>Type</Th>
              <Th align="right">Records</Th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {visible.map((r) => (
                <motion.tr key={r.table} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="h-10 border-b border-line">
                  <th scope="row" className="pr-3 text-left text-[13px] font-normal text-ink">
                    {r.title}
                  </th>
                  <td className="px-3 font-mono text-xs text-subtle">{r.file}</td>
                  <td className="px-3 text-xs text-subtle">{KIND_LABEL[r.kind] ?? r.kind}</td>
                  <td className="pl-3 text-right font-mono text-[13px] tabular-nums text-ink">{fmtNum(r.records)}</td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
        {rows.length > 8 && (
          <button type="button" aria-expanded={all} aria-controls={listId} onClick={() => setAll((v) => !v)} className="self-start rounded-sm text-xs font-medium text-ink underline decoration-1 underline-offset-[3px]">
            {all ? "Show fewer datasets" : `Show all ${rows.length} datasets`}
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- panels */

function ConnectorPanel({ c, state, onClose }: { c: (typeof CONNECTORS)[number]; state?: { connected: boolean; at: string | null }; onClose: () => void }) {
  const fetcher = useFetcher<{ ok: boolean; message?: string; error?: string }>({ key: `connector:${c.key}` });
  const pendingIntent = fetcher.state !== "idle" ? String(fetcher.formData?.get("intent")) : null;
  const connected = pendingIntent ? pendingIntent === "connect" : !!state?.connected;
  return (
    <>
      <PanelHeader id="connector-title" eyebrow={c.category} title={c.name} onClose={onClose} closeLabel="Close connector details">
        <div className="flex items-center gap-2">
          {connected ? <Pill tone="dashed">Simulated connection · no data flows</Pill> : <Pill>Not connected</Pill>}
        </div>
      </PanelHeader>
      <div className="flex flex-col gap-7 px-7 py-6">
        <section aria-labelledby="cn-supplies" className="flex flex-col gap-2">
          <h3 id="cn-supplies" className="label text-muted">
            What it would supply
          </h3>
          <ul className="flex flex-col border-t border-line">
            {c.supplies.map((s) => (
              <li key={s} className="border-b border-line py-2.5 text-[13px] text-text">
                {s}
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="cn-screens" className="flex flex-col gap-2">
          <h3 id="cn-screens" className="label text-muted">
            Screens that would use it
          </h3>
          <ul className="flex flex-col border-t border-line">
            {c.screens.map((s) => (
              <li key={s} className="border-b border-line py-2.5 text-[13px] text-text">
                {s}
              </li>
            ))}
          </ul>
        </section>
        <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-muted p-4">
          <div className="flex items-center gap-2">
            <DemoTag>Simulated</DemoTag>
          </div>
          <p className="text-[13px] leading-[19px] text-text">
            This prototype has no live connection to {c.name}. Marking it connected only records a flag so you can demo the flow. No data flows and no numbers on any screen
            change.
          </p>
          <fetcher.Form method="post" className="flex flex-col gap-2">
            <input type="hidden" name="key" value={c.key} />
            <div>
              {connected ? (
                <ActionButton name="intent" value="disconnect" pending={pendingIntent === "disconnect"} pendingLabel="Disconnecting…" size="md">
                  Disconnect
                </ActionButton>
              ) : (
                <ActionButton tone="ink" name="intent" value="connect" pending={pendingIntent === "connect"} pendingLabel="Connecting…" size="md">
                  Mark as connected (simulated)
                </ActionButton>
              )}
            </div>
            <StatusLine message={fetcher.state === "idle" && fetcher.data?.ok ? fetcher.data.message : undefined} />
            <StatusLine tone="error" message={fetcher.data && !fetcher.data.ok ? fetcher.data.error : undefined} />
          </fetcher.Form>
          {state?.connected && state.at && <p className="text-xs text-muted">Marked connected {fmtDateTime(state.at)} PT.</p>}
        </div>
      </div>
    </>
  );
}

function SyncPanel({ s, onClose }: { s: LoaderData["history"]["rows"][number]; onClose: () => void }) {
  const groups = [
    { id: "changed", title: "Programs whose data changed", refs: s.changed, empty: "No program's data changed." },
    { id: "closed", title: "Activities closed automatically", refs: s.closed, empty: "No activity was closed." },
    { id: "flagged", title: "Activities flagged for review", refs: s.flagged, empty: "No activity was flagged." },
  ];
  return (
    <>
      <PanelHeader id="sync-title" eyebrow={`Sync #${s.id} · ${s.source}`} title={`${fmtDateTime(s.ranAt)} PT`} onClose={onClose} closeLabel="Close sync details">
        <div className="flex flex-wrap items-center gap-3">
          {s.demo ? <DemoTag>Ran with demo corrections (simulated)</DemoTag> : <span className="text-xs text-subtle">Plain re-import, no corrections</span>}
          {s.activityId && (
            <Link to={`/a/${s.activityId}/sync`} className="text-xs font-medium text-ink underline underline-offset-4 hover:text-red-deep">
              Open sync activity →
            </Link>
          )}
        </div>
      </PanelHeader>
      <div className="flex flex-col gap-7 px-7 py-6">
        {groups.map((g) => (
          <section key={g.id} aria-labelledby={`sp-${g.id}`} className="flex flex-col gap-2">
            <h3 id={`sp-${g.id}`} className="label text-muted">
              {g.title} · {g.refs.length}
            </h3>
            {g.refs.length ? (
              <ul className="flex flex-col border-t border-line">
                {g.refs.map((r) => (
                  <li key={r.id} className="flex flex-col gap-0.5 border-b border-line py-2.5 text-[13px]">
                    {r.href ? (
                      <Link to={r.href} className="font-medium text-ink underline decoration-line-hover underline-offset-[3px] hover:decoration-ink">
                        {r.label}
                      </Link>
                    ) : (
                      <span className="text-ink">{r.label}</span>
                    )}
                    {r.program && <span className="text-xs text-muted">{r.program}</span>}
                    {r.note && <span className="text-xs text-subtle">Still open: {r.note}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-subtle">{g.empty}</p>
            )}
          </section>
        ))}
        {!s.demo && !s.changed.length && <p className="text-xs leading-[17px] text-muted">Without demo corrections the example data is static, so this sync found nothing to change.</p>}
      </div>
    </>
  );
}
