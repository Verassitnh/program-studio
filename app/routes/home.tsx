import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useNavigation, type ShouldRevalidateFunctionArgs } from "react-router";
import { usePendingStart } from "~/components/programs/actions";
import {
  LEVELS,
  kindMeta,
  matches,
  patchFor,
  plural,
  readState,
  sortRows,
  summarize,
  type ColumnKey,
  type Level,
  type SortKey,
  type TableState,
} from "~/components/programs/model";
import { PANEL_DEFAULT, ProgramPanel, ResizeHandle, clampWidth } from "~/components/programs/panel";
import { Chip, ChipGroup, ColumnsMenu, ProgramsTable, SearchBox, type Group } from "~/components/programs/table";
import { Button, Item, Stagger, cx } from "~/components/ui";
import { Kpi, KpiStrip, SlideOver, TopBar, fieldCls, useLatest } from "~/components/workspace/kit";
import { programDetail, programsTable } from "~/lib/programs.server";
import { getSettings, regions } from "~/lib/workspace.server";
import type { Route } from "./+types/home";

export const meta: Route.MetaFunction = () => [{ title: "Programs · Program Studio · Lightcast" }];

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const [settings, regionList] = await Promise.all([getSettings(), regions()]);
  const asked = url.searchParams.get("region");
  const region = asked && regionList.some((r) => r.code === asked) ? asked : settings.region;
  const selected = url.searchParams.get("p");
  const [rows, detail] = await Promise.all([programsTable({ region, smallN: settings.smallN }), selected ? programDetail(selected, region) : Promise.resolve(null)]);
  return {
    rows,
    detail,
    region,
    regionName: regionList.find((r) => r.code === region)?.name ?? settings.regionName,
    defaultRegion: settings.region,
    regions: regionList.map((r) => ({ code: r.code, name: r.name })),
    smallN: settings.smallN,
  };
}

/**
 * Sorting, filtering, searching, grouping and column choices are all client-side over the 92 rows, so they
 * don't re-run the loader. Only a new demand region, a newly selected program (its detail) or a form
 * submission does. Closing the panel keeps the data as it is.
 */
export function shouldRevalidate({ currentUrl, nextUrl, formMethod, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (formMethod && formMethod !== "GET") return defaultShouldRevalidate;
  if (currentUrl.pathname !== nextUrl.pathname) return defaultShouldRevalidate;
  const p = nextUrl.searchParams.get("p");
  if (currentUrl.searchParams.get("region") !== nextUrl.searchParams.get("region")) return true;
  if (p && p !== currentUrl.searchParams.get("p")) return true;
  return false;
}

/**
 * The table's URL state, answering at once: a control's own change is held locally (set synchronously,
 * outside the router's transition) until the router's location catches up; otherwise the URL being
 * navigated to (if it's this page), else the current one.
 */
function useLiveParams() {
  const location = useLocation();
  const nav = useNavigation();
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const routed = nav.location && nav.location.pathname === location.pathname ? nav.location.search : location.search;
  useEffect(() => {
    if (nav.state === "idle") setOptimistic(null);
  }, [nav.state, location.search]);
  const search = optimistic ?? routed;
  const params = useMemo(() => new URLSearchParams(search), [search]);
  // Two changes in one frame (before a re-render) build on each other, not on the same stale params.
  const latest = useRef(search);
  latest.current = search;
  const set = useCallback((next: string) => {
    latest.current = next;
    setOptimistic(next);
  }, []);
  return [params, set, latest] as const;
}

const WIDTH_KEY = "programs.panelWidth";

/** Slide-over width: 560 on the server and first paint, then the saved width (localStorage) once hydrated. */
function usePanelWidth() {
  const [width, setWidth] = useState(PANEL_DEFAULT);
  useEffect(() => {
    const saved = Number(window.localStorage.getItem(WIDTH_KEY));
    if (saved) setWidth(clampWidth(saved));
    const onResize = () => setWidth((w) => clampWidth(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const set = useCallback((w: number) => {
    setWidth(w);
    try {
      window.localStorage.setItem(WIDTH_KEY, String(w));
    } catch {}
  }, []);
  return { width, set };
}

/** While the panel edge is dragged: no text selection, no transitions, a resize cursor everywhere. */
const RESIZING_CSS = `html[data-panel-resizing], html[data-panel-resizing] * { user-select: none !important; cursor: col-resize !important; transition: none !important; }`;

export default function Home({ loaderData }: Route.ComponentProps) {
  const { rows, smallN, regionName } = loaderData;
  const [params, setOptimistic, latestSearch] = useLiveParams();
  const navigate = useNavigate();
  const nav = useNavigation();
  const loc = useLocation();
  const regionPending = nav.state === "loading" && params.get("region") !== new URLSearchParams(loc.search).get("region");
  const state = readState(params);
  const selectedId = params.get("p");
  const pending = usePendingStart();

  const go = (patch: Record<string, string | null>, push = false) => {
    const p = new URLSearchParams(latestSearch.current);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) p.delete(k);
      else p.set(k, v);
    }
    const s = p.toString();
    setOptimistic(s ? `?${s}` : "");
    navigate(s ? `/?${s}` : "/", { replace: !push, preventScrollReset: true });
  };
  const update = (next: Partial<TableState>) => go(patchFor(next));
  const hrefWith = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) p.delete(k);
      else p.set(k, v);
    }
    const s = p.toString();
    return s ? `/?${s}` : "/";
  };

  // Search types locally (instant filtering) and lands in the URL a beat later, replacing the history entry.
  const [text, setText] = useState(state.q);
  const pushed = useRef(state.q);
  useEffect(() => {
    if (state.q !== pushed.current) {
      pushed.current = state.q;
      setText(state.q);
    }
  }, [state.q]);
  useEffect(() => {
    if (text === pushed.current) return;
    const t = setTimeout(() => {
      pushed.current = text;
      update({ q: text });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  const live: TableState = { ...state, q: text };

  const filtered = useMemo(
    () =>
      sortRows(
        rows.filter((r) => matches(r, live)),
        live,
        smallN,
      ),
    [rows, text, params, smallN],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const kpi = summarize(filtered);
  const facet = (patch: Partial<TableState>) => rows.filter((r) => matches(r, { ...live, ...patch })).length;
  const families = useMemo(() => {
    const m = new Map<string, { key: string; label: string; n: number }>();
    for (const r of rows) {
      const f = m.get(r.family) ?? {
        key: r.family,
        label: r.familyLabel,
        n: 0,
      };
      f.n++;
      m.set(r.family, f);
    }
    return [...m.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  }, [rows]);

  const groups: Group[] = useMemo(() => {
    if (!state.group) return [{ key: "all", label: "All programs", rows: filtered }];
    return families
      .map((f) => ({
        key: f.key,
        label: f.label,
        rows: filtered.filter((r) => r.family === f.key),
      }))
      .filter((g) => g.rows.length);
  }, [filtered, families, state.group]);

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const filtersOn = state.levels.length + state.families.length + (state.activity ? 1 : 0) + (state.quality ? 1 : 0) + (text.trim() ? 1 : 0);
  const clearAll = () => {
    pushed.current = "";
    setText("");
    go({ q: null, level: null, family: null, activity: null, quality: null });
  };

  const selectedRow = rows.find((r) => r.id === selectedId) ?? null;
  const panelRow = useLatest(selectedRow);
  const detail = loaderData.detail && loaderData.detail.id === panelRow?.id ? loaderData.detail : null;
  const panelDetail = useLatest(detail);
  const closePanel = () => go({ p: null, occ: null }, true);
  const panelWidth = usePanelWidth();
  const regionSelect = useId();
  const startingRow = pending ? rows.find((r) => r.id === pending.programId) : null;

  return (
    <>
      <div data-ws-page className="flex min-h-screen flex-col">
        <TopBar trail="Programs">
          <Button tone="outline" to="/integrations" className="h-[34px]! text-[13px]! font-normal!">
            Import alumni data
          </Button>
        </TopBar>
        <Stagger className="flex grow flex-col gap-8 px-10 pb-12 pt-10">
          <Item className="flex flex-col gap-2">
            <h1 className="text-4xl font-semibold leading-10 tracking-[-0.03em] text-ink">Programs</h1>
            <p className="max-w-[880px] text-[15px] leading-[22px] text-pretty text-subtle">
              Good morning, Dean Okafor. Every North Sound State program, with its skill coverage, alumni outcomes and hiring demand.
            </p>
          </Item>

          <KpiStrip label={filtersOn ? "Summary of the filtered programs" : "Summary of all programs"}>
            <Kpi label="Programs" value={kpi.programs} sub={filtersOn ? `of ${rows.length} · ${kpi.live} with an open activity` : `${kpi.live} with an open activity`} />
            <Kpi label="Alumni records" value={kpi.alumni} sub={`${kpi.known.toLocaleString("en-US")} with a job on record`} />
            <Kpi
              label="Median coverage"
              value={kpi.coverage == null ? "—" : Math.round(kpi.coverage)}
              format={(v) => `${Math.round(v)}%`}
              sub="Best occupation match, King County, 2024"
            />
            <Kpi
              label="In field"
              value={kpi.inFieldPct == null ? "—" : kpi.inFieldPct}
              format={(v) => `${Math.round(v)}%`}
              sub={
                kpi.inFieldKnown
                  ? `${kpi.inField.toLocaleString("en-US")} of ${kpi.inFieldKnown.toLocaleString("en-US")} alumni with a known job`
                  : "No known jobs in this selection"
              }
            />
          </KpiStrip>

          <Item as="section" className="flex flex-col gap-4">
            <h2 className="sr-only">All programs</h2>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <SearchBox value={text} onChange={setText} />
                  <div role="status" className="text-xs tabular-nums text-subtle">
                    {filtersOn ? `${plural(filtered.length, "program", "programs")} of ${rows.length}` : plural(rows.length, "program", "programs")}
                  </div>
                  {filtersOn > 0 && (
                    <button
                      type="button"
                      onClick={clearAll}
                      className="rounded-sm text-xs font-medium text-ink underline decoration-line-hover underline-offset-[3px] transition-colors duration-150 hover:decoration-ink"
                    >
                      Clear filters
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2">
                    <label htmlFor={regionSelect} className="text-xs text-subtle">
                      Demand region
                    </label>
                    <select
                      id={regionSelect}
                      value={loaderData.region}
                      onChange={(e) =>
                        go({
                          region: e.target.value === loaderData.defaultRegion ? null : e.target.value,
                        })
                      }
                      className={cx(fieldCls, "h-9! w-auto! rounded-full! pr-8 text-[13px]")}
                    >
                      {loaderData.regions.map((r) => (
                        <option key={r.code} value={r.code}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    aria-pressed={state.group}
                    onClick={() => update({ group: !state.group })}
                    className={cx(
                      "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] transition-[background-color,border-color,color,scale] duration-150 ease-out active:scale-[0.96]",
                      state.group ? "border-ink bg-ink text-white" : "border-line text-ink hover:border-ink",
                    )}
                  >
                    Group by family
                  </button>
                  <ColumnsMenu cols={state.cols} onChange={(cols: ColumnKey[]) => update({ cols })} />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <ChipGroup label="Level">
                  {LEVELS.map((l) => (
                    <Chip
                      key={l.value}
                      on={state.levels.includes(l.value)}
                      count={facet({ levels: [l.value] })}
                      onClick={() => update({ levels: toggle<Level>(state.levels, l.value) })}
                    >
                      {l.label}
                    </Chip>
                  ))}
                </ChipGroup>
                <ChipGroup label="Activity">
                  <Chip
                    on={state.activity === "live"}
                    count={facet({ activity: "live" })}
                    onClick={() =>
                      update({
                        activity: state.activity === "live" ? "" : "live",
                      })
                    }
                  >
                    Has open activity
                  </Chip>
                  <Chip
                    on={state.activity === "none"}
                    count={facet({ activity: "none" })}
                    onClick={() =>
                      update({
                        activity: state.activity === "none" ? "" : "none",
                      })
                    }
                  >
                    None open
                  </Chip>
                </ChipGroup>
                <ChipGroup label="Data">
                  <Chip on={state.quality === "ok"} count={facet({ quality: "ok" })} onClick={() => update({ quality: state.quality === "ok" ? "" : "ok" })}>
                    {smallN}+ known jobs
                  </Chip>
                  <Chip
                    on={state.quality === "small"}
                    count={facet({ quality: "small" })}
                    onClick={() =>
                      update({
                        quality: state.quality === "small" ? "" : "small",
                      })
                    }
                  >
                    Too few records
                  </Chip>
                </ChipGroup>
              </div>
              <ChipGroup label="Family">
                {families.map((f) => (
                  <Chip
                    key={f.key}
                    on={state.families.includes(f.key)}
                    count={facet({ families: [f.key] })}
                    onClick={() => update({ families: toggle(state.families, f.key) })}
                  >
                    {f.label}
                  </Chip>
                ))}
              </ChipGroup>
            </div>

            <div className={cx("transition-opacity duration-150", regionPending && "opacity-60")}>
              <ProgramsTable
                groups={groups}
                grouped={state.group}
                state={live}
                cols={state.cols}
                smallN={smallN}
                selected={selectedId}
                hrefFor={(id) => hrefWith({ p: id })}
                onSort={(sort: SortKey, dir) => update({ sort, dir })}
                total={rows.length}
                emptyAction={
                  <Button tone="outline" size="sm" onClick={clearAll}>
                    Clear filters
                  </Button>
                }
              />
            </div>
          </Item>

          <Item className="flex max-w-[880px] flex-col gap-1.5 text-xs leading-[18px] text-pretty text-muted">
            <p>
              <span className="font-medium text-subtle">Coverage</span> is the program’s highest alignment score with an occupation in King County postings (2024); King
              County is the only region with alignment scores for this school. <span className="font-medium text-subtle">In field</span> and{" "}
              <span className="font-medium text-subtle">hired ≤ 6 mo</span> count alumni with a known job or a first-job date.{" "}
              <span className="font-medium text-subtle">Salary</span> is the median current-job salary reported per year; hourly wages are left out rather than
              annualized. <span className="font-medium text-subtle">Demand</span> is unique postings for the top occupation in {regionName}, 2024, and the change from
              2023.
            </p>
            <p>
              Rates based on fewer than {smallN} records show “—” (hover for the counts). Change the threshold in{" "}
              <Link to="/account" className="underline decoration-line-hover underline-offset-2 hover:text-ink hover:decoration-ink">
                Account settings
              </Link>
              . All figures come from the example dataset, which is itself synthetic.
            </p>
          </Item>
        </Stagger>
      </div>

      <style>{RESIZING_CSS}</style>
      {/* Announces the pending start; mounted empty so the update is read. */}
      <div role="status" className="sr-only">
        {pending && startingRow ? `${pending.kind === "survey" ? "Sending a survey" : `Opening ${kindMeta(pending.kind ?? "").label.toLowerCase()}`} for ${startingRow.name}…` : ""}
      </div>

      <SlideOver
        open={!!selectedRow}
        onClose={closePanel}
        labelledBy="program-title"
        returnFocus={panelRow ? `[data-row-link="${panelRow.id}"]` : null}
        width={panelWidth.width}
      >
        <ResizeHandle width={panelWidth.width} onChange={panelWidth.set} />
        {panelRow && (
          <ProgramPanel
            row={panelRow}
            detail={panelDetail?.id === panelRow.id ? panelDetail : null}
            loading={nav.state !== "idle"}
            smallN={smallN}
            regionName={regionName}
            selectedOcc={params.get("occ")}
            onSelectOcc={(occ) => go({ occ })}
            onClose={closePanel}
          />
        )}
      </SlideOver>
    </>
  );
}
