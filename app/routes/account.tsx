import { useEffect, useId, useState } from "react";
import { data, useFetcher } from "react-router";
import { Item, Stagger, Toggle, cx } from "~/components/ui";
import { ActionButton, DemoTag, SectionHead, StatusLine, TopBar, fieldCls } from "~/components/workspace/kit";
import { fmtDate, fmtNum } from "~/components/workspace/model";
import { accountData, saveSettings } from "~/lib/workspace.server";
import type { Route } from "./+types/account";

export const meta: Route.MetaFunction = () => [{ title: "Profile & settings · Program Studio · Lightcast" }];

export const loader = () => accountData();

export async function action({ request }: Route.ActionArgs) {
  const fd = await request.formData();
  const n = Number(fd.get("smallN"));
  const res = await saveSettings({ smallN: Number.isFinite(n) ? n : NaN, region: String(fd.get("region") ?? "") });
  return data(res.ok ? { ok: true as const, savedAt: Date.now() } : res, { status: res.ok ? 200 : 400 });
}

type SaveResult = { ok: true; savedAt: number } | { ok: false; field: string; error: string };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-8 border-b border-line py-3 text-[13px]">
      <dt className="shrink-0 text-subtle">{label}</dt>
      <dd className="min-w-0 text-right text-ink">{children}</dd>
    </div>
  );
}

export default function Account({ loaderData: d }: Route.ComponentProps) {
  const inst = d.institution;
  const fetcher = useFetcher<SaveResult>({ key: "settings" });
  const [smallN, setSmallN] = useState(String(d.settings.smallN));
  const [region, setRegion] = useState(d.settings.region);
  const [saved, setSaved] = useState(false);
  const ids = { n: useId(), nHelp: useId(), nErr: useId(), region: useId(), labels: useId(), labelsHelp: useId() };
  const pending = fetcher.state !== "idle";
  const err = fetcher.data && !fetcher.data.ok ? fetcher.data : null;
  const dirty = smallN !== String(d.settings.smallN) || region !== d.settings.region;
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) setSaved(true);
  }, [fetcher.state, fetcher.data]);
  useEffect(() => {
    if (dirty) setSaved(false);
  }, [dirty]);

  return (
    <div data-ws-page className="flex min-h-screen flex-col">
      <TopBar trail="Profile & settings" />
      <Stagger className="flex max-w-[880px] grow flex-col gap-12 px-10 pb-16 pt-10">
        <Item className="flex flex-col gap-2">
          <h1 className="text-4xl font-semibold leading-10 tracking-[-0.03em] text-ink">Profile & settings</h1>
          <p className="text-[15px] leading-[22px] text-subtle">Who you are in Program Studio, the institution it describes, and how figures are shown.</p>
        </Item>

        <Item as="section" className="flex scroll-mt-8 flex-col gap-3">
          <SectionHead id="profile" title="Profile" />
          <div className="flex items-center gap-4 py-2">
            <div aria-hidden className="flex h-12 w-12 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white">
              RO
            </div>
            <div className="flex flex-col">
              <div className="text-[15px] font-medium text-ink">Dean R. Okafor</div>
              <div className="text-[13px] text-subtle">Dean, School of Business</div>
            </div>
          </div>
          <dl className="border-t border-line">
            <Row label="Email">
              <span className="font-mono text-xs text-subtle">r.okafor@example.edu</span> <DemoTag>placeholder</DemoTag>
            </Row>
            <Row label="Role">Dean · can start activities, send surveys and export</Row>
            <Row label="School">School of Business</Row>
          </dl>
        </Item>

        <Item as="section" className="flex flex-col gap-3">
          <div id="institution" className="scroll-mt-8">
            <SectionHead title="Institution" sub="Counted from the local import. The institution, people and records are fictional example data." />
          </div>
          <dl className="border-t border-line">
            <Row label="Institution">{inst.name}</Row>
            <Row label="Programs">
              <span className="font-mono tabular-nums">{fmtNum(inst.programs)}</span> <span className="text-subtle">({inst.school} in the School of Business)</span>
            </Row>
            <Row label="Alumni records">
              <span className="font-mono tabular-nums">{fmtNum(inst.alumni)}</span> <span className="text-subtle">· {fmtNum(inst.employers)} employers</span>
            </Row>
            <Row label="Courses">
              <span className="font-mono tabular-nums">{fmtNum(inst.courses)}</span>
            </Row>
            <Row label="Data as of">{fmtDate(`${inst.dataAsOf}T12:00:00Z`)}</Row>
            <Row label="Region and benchmark">
              {d.settings.regionName} · {inst.period} postings · <span className="font-mono tabular-nums">{fmtNum(inst.benchmark.postings)}</span> postings across{" "}
              {inst.benchmark.occs} occupations
            </Row>
          </dl>
        </Item>

        <Item as="section" className="flex flex-col gap-4">
          <div id="preferences" className="scroll-mt-8">
            <SectionHead title="Preferences" sub="Apply to the Surveys, Integrations and Exports pages." />
          </div>
          <fetcher.Form method="post" className="flex flex-col gap-6 border-t border-line pt-5">
            <div className="grid grid-cols-[minmax(0,1fr)_200px] items-start gap-8">
              <div className="flex flex-col gap-1">
                <label htmlFor={ids.n} className="text-[13px] font-medium text-ink">
                  Small-sample threshold
                </label>
                <p id={ids.nHelp} className="text-xs leading-[17px] text-subtle">
                  Figures based on fewer records than this are flagged “small sample”. Default 10.
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <input
                  id={ids.n}
                  name="smallN"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100}
                  step={1}
                  value={smallN}
                  onChange={(e) => setSmallN(e.target.value)}
                  aria-describedby={cx(ids.nHelp, err?.field === "smallN" && ids.nErr) || undefined}
                  aria-invalid={err?.field === "smallN" || undefined}
                  className={cx(fieldCls, "font-mono tabular-nums", err?.field === "smallN" && "border-red")}
                />
                {err?.field === "smallN" && (
                  <p id={ids.nErr} className="text-xs text-red">
                    {err.error}
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_200px] items-start gap-8">
              <div className="flex flex-col gap-1">
                <label htmlFor={ids.region} className="text-[13px] font-medium text-ink">
                  Default target region
                </label>
                <p className="text-xs leading-[17px] text-subtle">Benchmark region for alignment and skill-coverage exports. Activities keep the region they started with.</p>
              </div>
              <select id={ids.region} name="region" value={region} onChange={(e) => setRegion(e.target.value)} className={fieldCls}>
                {d.regions.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_200px] items-start gap-8">
              <div className="flex flex-col gap-1">
                <label htmlFor={ids.labels} className="text-[13px] font-medium text-ink">
                  Show simulated data labels
                </label>
                <p id={ids.labelsHelp} className="text-xs leading-[17px] text-subtle">
                  Always on. Survey responses, demo corrections and connector states are simulated in this prototype, and every one of them stays labelled so nobody mistakes it
                  for a real figure.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input id={ids.labels} type="checkbox" role="switch" checked disabled readOnly aria-describedby={ids.labelsHelp} className="sr-only" />
                <div className="pointer-events-none opacity-60" aria-hidden>
                  <Toggle on size="sm" />
                </div>
                <span aria-hidden className="text-xs text-subtle">
                  On · locked
                </span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <ActionButton tone="ink" size="md" pending={pending} pendingLabel="Saving…">
                Save preferences
              </ActionButton>
              <StatusLine message={saved && !dirty && !pending ? "Preferences saved." : dirty && !pending ? "Unsaved changes" : undefined} />
            </div>
            <StatusLine tone="error" message={err && err.field !== "smallN" ? err.error : undefined} />
          </fetcher.Form>
        </Item>

        <Item as="section" className="flex flex-col gap-3">
          <SectionHead id="session" title="Session" />
          <div className="flex items-center gap-3 border-t border-line pt-5">
            <button type="button" aria-disabled="true" aria-describedby="signout-note" className="h-9 cursor-not-allowed rounded-full border border-line px-4 text-[13px] font-medium text-subtle opacity-60">
              Sign out
            </button>
            <DemoTag />
            <span id="signout-note" className="text-xs text-muted">
              This prototype has no accounts, so there's nothing to sign out of.
            </span>
          </div>
        </Item>
      </Stagger>
    </div>
  );
}
