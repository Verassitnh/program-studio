import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useMemo, useState } from "react";
import { Link, data, useFetcher, useFetchers, useNavigate, useSearchParams } from "react-router";
import { Button, HBar, Item, Stagger, cx, ease } from "~/components/ui";
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
  SmallN,
  StatusLine,
  Th,
  TopBar,
  fieldCls,
  rowClick,
  useHrefWith,
  useLatest,
} from "~/components/workspace/kit";
import {
  AUDIENCE_LABEL,
  DEFAULT_TEMPLATE,
  DEMO_CLOCK,
  STATUS_LABEL,
  type Audience,
  type SurveyStatus,
  fmtDate,
  fmtDateTime,
  fmtNum,
  plural,
  shortProgram,
  templateById,
  templatesFor,
} from "~/components/workspace/model";
import {
  closeSurvey,
  createDraftsForUnknownOutcomes,
  createSurvey,
  deleteDraft,
  duplicateSurvey,
  getSurvey,
  remindSurvey,
  scheduleSurvey,
  sendSurvey,
  surveysPage,
  unscheduleSurvey,
} from "~/lib/workspace.server";
import type { Route } from "./+types/surveys";

export const meta: Route.MetaFunction = () => [{ title: "Surveys · Program Studio · Lightcast" }];

export async function loader({ request }: Route.LoaderArgs) {
  const sid = Number(new URL(request.url).searchParams.get("s"));
  const [page, detail] = await Promise.all([surveysPage(), Number.isInteger(sid) && sid > 0 ? getSurvey(sid) : null]);
  return { ...page, detail };
}

export async function action({ request }: Route.ActionArgs) {
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const id = Number(fd.get("id"));
  const str = (k: string) => String(fd.get(k) ?? "");
  let res: { ok: boolean; id?: number; message?: string; error?: string; existingId?: number; created?: number };
  switch (intent) {
    case "create": {
      res = await createSurvey({ programId: str("programId"), audience: str("audience") as Audience, template: str("template"), activityId: str("activityId") || null });
      if (res.ok && str("then") === "send" && res.id) {
        const sent = await sendSurvey(res.id);
        res = sent.ok ? { ...sent, message: `Created and ${sent.message.charAt(0).toLowerCase()}${sent.message.slice(1)}` } : { ok: true, id: res.id, message: `Draft created, not sent: ${sent.error}` };
      }
      break;
    }
    case "bulk":
      res = await createDraftsForUnknownOutcomes();
      break;
    case "send":
      res = await sendSurvey(id);
      break;
    case "schedule": {
      const d = str("date");
      res = /^\d{4}-\d{2}-\d{2}$/.test(d) ? await scheduleSurvey(id, new Date(`${d}T09:00:00-08:00`)) : { ok: false, error: "Choose a send date." };
      break;
    }
    case "unschedule":
      res = await unscheduleSurvey(id);
      break;
    case "remind":
      res = await remindSurvey(id);
      break;
    case "close":
      res = await closeSurvey(id);
      break;
    case "duplicate":
      res = await duplicateSurvey(id);
      break;
    case "delete":
      res = await deleteDraft(id);
      break;
    default:
      res = { ok: false, error: "Unknown action." };
  }
  return data({ intent, ...res }, { status: res.ok ? 200 : 400 });
}

type LoaderData = Route.ComponentProps["loaderData"];
type Row = LoaderData["surveys"][number] & { pending?: string };
type Detail = NonNullable<LoaderData["detail"]>;
type Program = LoaderData["programs"][number];
type ActionData = { intent: string; ok: boolean; id?: number; message?: string; error?: string; existingId?: number; created?: number };

const STATUS_TONE: Record<SurveyStatus, "red" | "ink" | "solid" | "muted"> = { draft: "muted", scheduled: "ink", sent: "red", closed: "solid" };

/* ------------------------------------------------- optimistic patches */

function useOptimisticRows(rows: LoaderData["surveys"], programs: Program[]): Row[] {
  const fetchers = useFetchers();
  return useMemo(() => {
    let out: Row[] = rows.map((r) => ({ ...r }));
    const now = new Date().toISOString();
    for (const f of fetchers) {
      const fd = f.formData;
      if (!fd) continue;
      const intent = String(fd.get("intent"));
      const id = Number(fd.get("id"));
      if (intent === "create") {
        const p = programs.find((x) => x.id === fd.get("programId"));
        const audience = String(fd.get("audience")) as Audience;
        if (!p || out.some((r) => r.programId === p.id && r.audience === audience && r.status !== "closed")) continue;
        out = [ghost(-1, p, audience, String(fd.get("template")), now), ...out];
        continue;
      }
      if (intent === "bulk") {
        const ghosts = programs
          .filter((p) => p.noJob > 0 && !out.some((r) => r.programId === p.id && r.audience === "alumni" && r.status !== "closed"))
          .map((p, i) => ghost(-100 - i, p, "alumni", "alumni-outcomes", now));
        out = [...ghosts, ...out];
        continue;
      }
      if (intent === "delete") {
        out = out.filter((r) => r.id !== id);
        continue;
      }
      out = out.map((r) => {
        if (r.id !== id) return r;
        const p: Row = { ...r, pending: intent };
        if (intent === "send") Object.assign(p, { status: "sent", sentAt: now, scheduledFor: null, recipients: r.liveRecipients, demo: r.demo ?? { responses: 0, rate: 0, nonResponders: r.liveRecipients, day: 0, label: DEMO_CLOCK } });
        if (intent === "schedule") Object.assign(p, { status: "scheduled", scheduledFor: `${fd.get("date")}T17:00:00.000Z` });
        if (intent === "unschedule") Object.assign(p, { status: "draft", scheduledFor: null });
        if (intent === "close") Object.assign(p, { status: "closed", closedAt: now });
        if (intent === "remind") Object.assign(p, { reminders: [...r.reminders, now] });
        return p;
      });
    }
    return out;
  }, [rows, programs, fetchers]);
}

function ghost(id: number, p: Program, audience: Audience, template: string, now: string): Row {
  const recipients = audience === "alumni" ? p.email : p.employers;
  return {
    id,
    programId: p.id,
    programName: p.name,
    audience,
    template,
    status: "draft",
    wave: 1,
    activityId: null,
    threadId: null,
    recipients,
    liveRecipients: recipients,
    scheduledFor: null,
    sentAt: null,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
    reminders: [],
    gap: audience === "alumni" ? p.noJob : p.employedWithEmployer,
    gapLabel: audience === "alumni" ? `Fills up to ${p.noJob} unknown jobs` : `Asks the employers of ${p.employedWithEmployer} grads`,
    demo: null,
    pending: "create",
  };
}

/* ---------------------------------------------------------------- page */

export default function Surveys({ loaderData }: Route.ComponentProps) {
  const { kpis, programs, settings } = loaderData;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const hrefWith = useHrefWith();
  const rows = useOptimisticRows(loaderData.surveys, programs);
  const status = (params.get("status") ?? "") as SurveyStatus | "";
  const audience = (params.get("audience") ?? "") as Audience | "";
  const selected = Number(params.get("s")) || null;
  const creating = params.get("new") === "1";
  const shown = rows.filter((r) => (!status || r.status === status) && (!audience || r.audience === audience));
  const count = (s: SurveyStatus) => rows.filter((r) => r.status === s && (!audience || r.audience === audience)).length;
  const bulk = useFetcher<ActionData>({ key: "surveys-bulk" });
  const bulkTargets = programs.filter((p) => p.noJob > 0 && !rows.some((r) => r.programId === p.id && r.audience === "alumni" && r.status !== "closed")).length;

  const detail = useLatest(loaderData.detail && loaderData.detail.id === selected ? loaderData.detail : null);
  const closePanel = () => navigate(hrefWith({ s: null }), { preventScrollReset: true, replace: false });
  const closeNew = () => navigate(hrefWith({ new: null, program: null, audience: null }), { preventScrollReset: true });

  return (
    <>
      <div data-ws-page className="flex min-h-screen flex-col">
        <TopBar trail="Surveys" />
        <Stagger className="flex grow flex-col gap-8 px-10 pb-12 pt-10">
          <Item className="flex items-end justify-between gap-8">
            <div className="flex flex-col gap-2">
              <h1 className="text-4xl font-semibold leading-10 tracking-[-0.03em] text-ink">Surveys</h1>
              <p className="text-[15px] leading-[22px] text-subtle">Ask alumni and employers what your records can't tell you, then track who answered.</p>
            </div>
            <div className="flex shrink-0 gap-2">
              {rows.length > 0 && bulkTargets > 0 && (
                <bulk.Form method="post">
                  <input type="hidden" name="intent" value="bulk" />
                  <ActionButton size="md" pending={bulk.state !== "idle"} pendingLabel="Creating drafts…">
                    Draft for {plural(bulkTargets, "more program", "more programs")}
                  </ActionButton>
                </bulk.Form>
              )}
              <Button tone="ink" to={hrefWith({ new: "1", s: null })} className="h-[38px]! px-[18px]! text-sm!">
                New survey
              </Button>
            </div>
          </Item>

          <KpiStrip label="Survey summary">
            <Kpi label="Programs with unknowns" value={kpis.unknownPrograms} sub={`of ${kpis.programs} School of Business programs`} />
            <Kpi label="Alumni with no job" value={kpis.noJob} tone="red" sub={`of ${fmtNum(kpis.alumni)} program alumni on record`} />
            <Kpi label="Open surveys" value={kpis.open} sub={`${kpis.live} sent · ${kpis.scheduled} scheduled · ${kpis.drafts} drafts`} />
            <Kpi label="Recipients reached" value={kpis.reached} sub="Counted from records when each survey was sent" />
            <Kpi label="Responses" value={kpis.demoResponses} demo sub="Simulated. Never added to real figures." />
          </KpiStrip>

          <Item as="section" className="flex flex-col gap-4">
            <h2 className="sr-only">All surveys</h2>
            {rows.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Segmented
                  label="Filter by status"
                  param="status"
                  value={status}
                  options={[
                    { value: "", label: "All", count: rows.filter((r) => !audience || r.audience === audience).length },
                    { value: "draft", label: "Draft", count: count("draft") },
                    { value: "scheduled", label: "Scheduled", count: count("scheduled") },
                    { value: "sent", label: "Sent", count: count("sent") },
                    { value: "closed", label: "Closed", count: count("closed") },
                  ]}
                />
                <Segmented
                  label="Filter by audience"
                  param="audience"
                  value={audience}
                  options={[
                    { value: "", label: "Both audiences" },
                    { value: "alumni", label: "Alumni" },
                    { value: "employers", label: "Employers" },
                  ]}
                />
              </div>
            )}
            {rows.length === 0 ? (
              <Empty
                title="No surveys yet"
                action={
                  <>
                    <bulk.Form method="post">
                      <input type="hidden" name="intent" value="bulk" />
                      <ActionButton tone="red" size="md" pending={bulk.state !== "idle"} pendingLabel="Creating drafts…">
                        Create surveys for all {kpis.unknownPrograms} programs with unknown outcomes
                      </ActionButton>
                    </bulk.Form>
                    <Button tone="outline" to={hrefWith({ new: "1" })}>
                      Start one survey
                    </Button>
                  </>
                }
              >
                {fmtNum(kpis.noJob)} alumni across {kpis.unknownPrograms} School of Business programs have no job on record. An alumni survey asks them directly. The bulk action
                creates one draft per program; nothing is sent until you send it.
              </Empty>
            ) : shown.length === 0 ? (
              <Empty title="No surveys match these filters" action={<Button tone="outline" to="?">Clear filters</Button>}>
                Try another status or audience.
              </Empty>
            ) : (
              <SurveyTable rows={shown} selected={selected} smallN={settings.smallN} />
            )}
            <StatusLine message={bulk.data?.ok ? bulk.data.message : undefined} />
            <StatusLine tone="error" message={bulk.data && !bulk.data.ok ? bulk.data.error : undefined} />
          </Item>

          <Item className="text-xs leading-[18px] text-muted">
            Audience sizes are counted from alumni records: alumni with an email on file, or the distinct employers of a program's grads. Response counts are simulated
            for this demo ({DEMO_CLOCK.toLowerCase()}) and labelled <DemoTag /> wherever they appear.
          </Item>
        </Stagger>
      </div>

      <SlideOver open={!!selected && !!loaderData.detail} onClose={closePanel} labelledBy="survey-title" returnFocus={detail ? `[data-row-link="${detail.id}"]` : null}>
        {detail && <SurveyPanel d={detail} row={rows.find((r) => r.id === detail.id)} onClose={closePanel} smallN={settings.smallN} />}
      </SlideOver>
      <SlideOver open={creating} onClose={closeNew} labelledBy="new-survey-title" width={560}>
        <NewSurvey programs={programs} rows={rows} onClose={closeNew} smallN={settings.smallN} />
      </SlideOver>
    </>
  );
}

/* --------------------------------------------------------------- table */

function SurveyTable({ rows, selected, smallN }: { rows: Row[]; selected: number | null; smallN: number }) {
  const navigate = useNavigate();
  const hrefWith = useHrefWith();
  return (
    <table className="w-full border-collapse text-left">
      <caption className="sr-only">Surveys. Select a survey to open its details.</caption>
      <thead>
        <tr>
          <Th className="w-[30%]">Survey</Th>
          <Th>Status</Th>
          <Th align="right">Recipients</Th>
          <Th>Targets</Th>
          <Th>Timeline</Th>
          <Th className="w-[180px]">
            Responses <DemoTag />
          </Th>
        </tr>
      </thead>
      <tbody>
        <AnimatePresence initial={false}>
          {rows.map((r) => {
            const href = hrefWith({ s: String(r.id), new: null });
            const on = r.id === selected;
            const ghostRow = r.id < 0;
            return (
              <motion.tr
                key={r.id}
                layout="position"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: ghostRow ? 0.6 : 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.15, ease: "easeOut" } }}
                transition={{ duration: 0.3, ease }}
                onClick={ghostRow ? undefined : rowClick(href, navigate)}
                data-selected={on || undefined}
                className={cx(
                  "group h-16 border-b border-line transition-colors duration-150",
                  ghostRow ? "cursor-progress" : "cursor-pointer hover:bg-row-hover",
                  on && "bg-surface hover:bg-surface",
                )}
              >
                <th scope="row" className="py-3 pr-3 text-left font-normal">
                  {ghostRow ? (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[15px] font-medium text-ink">{shortProgram(r.programName)}</span>
                      <span className="text-xs text-muted">{AUDIENCE_LABEL[r.audience]} · creating…</span>
                    </div>
                  ) : (
                    <Link
                      to={href}
                      preventScrollReset
                      data-row-link={r.id}
                      aria-current={on ? "true" : undefined}
                      className="flex flex-col gap-0.5 rounded-sm focus-visible:outline-offset-4"
                    >
                      <span className="flex items-center gap-2 text-[15px] font-medium text-ink">
                        <span className="truncate">{shortProgram(r.programName)}</span>
                        {on && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-red" />}
                      </span>
                      <span className="truncate text-xs text-muted">
                        {AUDIENCE_LABEL[r.audience]} · {templateById(r.template)?.name ?? r.template}
                        {r.wave > 1 ? ` · wave ${r.wave}` : ""}
                      </span>
                    </Link>
                  )}
                </th>
                <td className="px-3">
                  <Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill>
                </td>
                <td className="px-3 text-right font-mono text-[13px] tabular-nums text-ink">
                  {fmtNum(r.recipients)}
                  <div className="text-[11px] text-muted">{r.audience === "alumni" ? "with email" : "employers"}</div>
                </td>
                <td className="px-3 text-[13px] text-text">
                  <span className={cx(r.audience === "alumni" && r.gap > 0 && "font-medium text-red")}>{r.gapLabel}</span>
                  {r.recipients < smallN && (
                    <div>
                      <SmallN n={r.recipients} min={smallN} />
                    </div>
                  )}
                </td>
                <td className="px-3 text-[13px] text-subtle">
                  {r.status === "draft" && <>Created {fmtDate(r.createdAt)}</>}
                  {r.status === "scheduled" && <>Sends {fmtDateTime(r.scheduledFor)}</>}
                  {r.status === "sent" && (
                    <>
                      Sent {fmtDate(r.sentAt)}
                      {r.reminders.length > 0 && <div className="text-xs text-muted">{plural(r.reminders.length, "reminder", "reminders")}</div>}
                    </>
                  )}
                  {r.status === "closed" && <>Closed {fmtDate(r.closedAt)}</>}
                  {r.threadId && (
                    <div>
                      <Link to={`/a/${r.threadId}/survey`} onClick={(e) => e.stopPropagation()} className="text-xs text-ink underline underline-offset-2 hover:text-red-deep">
                        Open activity
                      </Link>
                    </div>
                  )}
                </td>
                <td className="pl-3">
                  {r.demo ? (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-baseline justify-between font-mono text-xs tabular-nums">
                        <span className="text-ink">
                          {r.demo.responses}/{r.recipients}
                        </span>
                        <span className="text-muted">{r.demo.rate}%</span>
                      </div>
                      <div className="rounded-full border border-dashed border-muted p-px">
                        <HBar pct={r.demo.rate} h={3} color="bg-subtle" track="bg-transparent" />
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-muted">Not sent</span>
                  )}
                </td>
              </motion.tr>
            );
          })}
        </AnimatePresence>
      </tbody>
    </table>
  );
}

/* --------------------------------------------------------- detail panel */

const EVENT_LABEL: Record<string, (d: Record<string, unknown>) => string> = {
  created: (d) => (d.bulk ? "Draft created (bulk)" : `Draft created${Number(d.wave) > 1 ? `, wave ${d.wave}` : ""}`),
  scheduled: (d) => `Scheduled for ${fmtDateTime(String(d.for))} PT`,
  unscheduled: () => "Schedule cancelled",
  sent: (d) => `Sent to ${fmtNum(Number(d.recipients))} recipients${d.scheduled ? " (on schedule)" : ""}`,
  reminded: (d) => `Reminder to ${fmtNum(Number(d.non_responders))} non-responders (demo count)`,
  closed: () => "Closed. Responses frozen.",
  duplicated: (d) => `Duplicated from survey #${d.from}`,
};

function SurveyPanel({ d, row, onClose, smallN }: { d: Detail; row?: Row; onClose: () => void; smallN: number }) {
  const fetcher = useFetcher<ActionData>({ key: `survey:${d.id}` });
  const navigate = useNavigate();
  const hrefWith = useHrefWith();
  const [confirm, setConfirm] = useState<null | "send" | "remind" | "close" | "delete">(null);
  const [date, setDate] = useState("");
  const status = row?.status ?? d.status;
  const demo = row?.demo ?? d.demo;
  const reminders = row?.reminders ?? d.reminders;
  const template = templateById(d.template);
  const pending = fetcher.state !== "idle" ? String(fetcher.formData?.get("intent") ?? "") : null;
  const dateId = useId();
  useEffect(() => setConfirm(null), [status, d.id]);
  useEffect(() => {
    const r = fetcher.data;
    if (fetcher.state !== "idle" || !r?.ok) return;
    if (r.intent === "duplicate" && r.id && r.id !== d.id) navigate(hrefWith({ s: String(r.id) }), { preventScrollReset: true });
    if (r.intent === "delete") onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const recipients = status === "draft" || status === "scheduled" ? d.liveRecipients : d.recipients;
  const audienceWord = d.audience === "alumni" ? "alumni" : "employers";
  const consequences = {
    send: `Send to ${fmtNum(recipients)} ${audienceWord}? A sent survey can't be unsent.`,
    remind: `Send a reminder to ${fmtNum(demo?.nonResponders ?? recipients)} non-responders (demo count)? ${3 - reminders.length} of 3 reminders left.`,
    close: "Close this survey? Late answers won't count and responses are frozen.",
    delete: "Delete this draft? It has not been sent, so nobody is affected.",
  } as const;
  const confirmLabel = { send: "Send survey", remind: "Send reminder", close: "Close survey", delete: "Delete draft" } as const;

  return (
    <>
      <PanelHeader
        id="survey-title"
        onClose={onClose}
        closeLabel="Close survey details"
        eyebrow={`${AUDIENCE_LABEL[d.audience]} survey${d.wave > 1 ? ` · wave ${d.wave}` : ""} · #${d.id}`}
        title={d.programName}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>
          <span className="text-xs text-subtle">
            {template?.name} · {plural(template?.questions.length ?? 0, "question", "questions")} · about {template?.minutes} min
          </span>
        </div>
        <fetcher.Form method="post" className="flex flex-col gap-2" onSubmit={() => setConfirm(null)}>
          <input type="hidden" name="id" value={d.id} />
          {confirm ? (
            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease }} className="flex flex-col gap-2.5 rounded-xl bg-surface p-3.5">
              <p className="text-[13px] leading-[18px] text-ink">{consequences[confirm]}</p>
              <div className="flex gap-2">
                <ActionButton tone={confirm === "send" ? "red" : "ink"} name="intent" value={confirm} pending={pending === confirm} pendingLabel="Working…">
                  {confirmLabel[confirm]}
                </ActionButton>
                <ActionButton type="button" tone="ghost" onClick={() => setConfirm(null)}>
                  Cancel
                </ActionButton>
              </div>
            </motion.div>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              {(status === "draft" || status === "scheduled") && (
                <ActionButton type="button" tone="red" onClick={() => setConfirm("send")} pending={pending === "send"} pendingLabel="Sending…" disabledReason={recipients ? undefined : "No recipients on record"}>
                  Send now
                </ActionButton>
              )}
              {(status === "draft" || status === "scheduled") && (
                <div className="flex items-end gap-1.5">
                  <label htmlFor={dateId} className="sr-only">
                    Send date
                  </label>
                  <input id={dateId} name="date" type="date" min={tomorrow} value={date} onChange={(e) => setDate(e.target.value)} className={cx(fieldCls, "h-[30px] w-[150px] text-xs")} />
                  <ActionButton name="intent" value="schedule" pending={pending === "schedule"} pendingLabel="Scheduling…">
                    {status === "scheduled" ? "Change date" : "Schedule"}
                  </ActionButton>
                </div>
              )}
              {status === "scheduled" && (
                <ActionButton tone="ghost" name="intent" value="unschedule" pending={pending === "unschedule"}>
                  Cancel schedule
                </ActionButton>
              )}
              {status === "draft" && (
                <ActionButton type="button" tone="ghost" onClick={() => setConfirm("delete")}>
                  Delete draft
                </ActionButton>
              )}
              {status === "sent" && (
                <>
                  <ActionButton type="button" tone="ink" onClick={() => setConfirm("remind")} pending={pending === "remind"} pendingLabel="Sending reminder…" disabledReason={reminders.length >= 3 ? "3 reminders already sent" : undefined}>
                    Send reminder to non-responders
                  </ActionButton>
                  <ActionButton type="button" onClick={() => setConfirm("close")} pending={pending === "close"} pendingLabel="Closing…">
                    Close survey
                  </ActionButton>
                </>
              )}
              {status === "closed" && (
                <ActionButton name="intent" value="duplicate" pending={pending === "duplicate"} pendingLabel="Duplicating…" disabledReason={d.openSibling ? `Survey #${d.openSibling} is already open for this audience` : undefined}>
                  Duplicate as a new wave
                </ActionButton>
              )}
            </div>
          )}
          <StatusLine message={fetcher.data?.ok && fetcher.state === "idle" ? fetcher.data.message : undefined} />
          <StatusLine tone="error" message={fetcher.data && !fetcher.data.ok ? fetcher.data.error : undefined} />
        </fetcher.Form>
      </PanelHeader>

      <div className="flex flex-col gap-8 px-7 py-6">
        <section aria-labelledby="sv-targets" className="flex flex-col gap-2">
          <h3 id="sv-targets" className="label text-muted">
            Gaps this survey targets
          </h3>
          {d.breakdown.kind === "alumni" ? (
            <ul className="flex flex-col gap-1.5 text-[13px] leading-[19px] text-text">
              <li>
                <span className="font-medium text-red">Fills up to {fmtNum(d.breakdown.noJob)} unknown jobs</span> in {d.programName}
                <span className="block text-subtle">{fmtNum(d.breakdown.noJobEmail)} of those alumni have an email on file.</span>
              </li>
              {template?.questions.some((q) => q.gap === "missing_wages") && <li>Asks for a salary range: {fmtNum(d.breakdown.noWage)} alumni have no wage on record.</li>}
            </ul>
          ) : (
            <p className="text-[13px] leading-[19px] text-text">
              Asks the {fmtNum(d.breakdown.employers)} employers who hire {fmtNum(d.breakdown.grads)} of this program's grads which skills mattered and whether they'd hire again.
            </p>
          )}
        </section>

        <section aria-labelledby="sv-responses" className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <h3 id="sv-responses" className="label text-muted">
              Responses
            </h3>
            <DemoTag>Simulated · demo</DemoTag>
          </div>
          {demo ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-[28px] font-semibold leading-8 tracking-[-0.02em] tabular-nums text-ink">{demo.responses}</span>
                <span className="text-[13px] text-subtle">
                  of {fmtNum(recipients)} ({demo.rate}%) · day {demo.day}
                </span>
              </div>
              <div className="rounded-full border border-dashed border-muted p-0.5" role="img" aria-label={`Simulated: ${demo.responses} of ${recipients} responded`}>
                <HBar pct={demo.rate} h={6} color="bg-subtle" track="bg-transparent" />
              </div>
              <p className="text-xs leading-[17px] text-muted">
                The example data has no survey answers. These counts are generated from the send time and reminders ({DEMO_CLOCK.toLowerCase()}) and never feed a real metric.
              </p>
            </>
          ) : (
            <p className="text-[13px] text-subtle">No responses until the survey is sent.</p>
          )}
        </section>

        <section aria-labelledby="sv-audience" className="flex flex-col gap-2.5">
          <h3 id="sv-audience" className="label text-muted">
            Audience
          </h3>
          {d.breakdown.kind === "alumni" ? (
            <>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
                {(
                  [
                    ["Alumni on record", d.breakdown.alumni],
                    ["With an email (recipients)", d.breakdown.email],
                    ["No email, not reachable", d.breakdown.noEmail],
                    ["No job on record", d.breakdown.noJob],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 border-b border-line pb-2">
                    <dt className="text-subtle">{k}</dt>
                    <dd className="font-mono tabular-nums text-ink">{fmtNum(v)}</dd>
                  </div>
                ))}
              </dl>
              <table className="w-full text-[13px]">
                <caption className="sr-only">Alumni by graduating class</caption>
                <thead>
                  <tr>
                    <Th>Class</Th>
                    <Th align="right">Alumni</Th>
                    <Th align="right">With email</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.breakdown.cohorts.map((c) => (
                    <tr key={c.cohort} className="border-b border-line">
                      <th scope="row" className="py-2 text-left font-normal text-text">
                        {c.cohort} <SmallN n={c.n} min={smallN} />
                      </th>
                      <td className="py-2 text-right font-mono tabular-nums">{c.n}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{c.email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <table className="w-full text-[13px]">
              <caption className="sr-only">Employers of this program's grads</caption>
              <thead>
                <tr>
                  <Th>Employer</Th>
                  <Th align="right">Grads employed</Th>
                </tr>
              </thead>
              <tbody>
                {d.breakdown.top.map((e) => (
                  <tr key={e.employer} className="border-b border-line">
                    <th scope="row" className="py-2 text-left font-normal text-text">
                      {e.employer}
                    </th>
                    <td className="py-2 text-right font-mono tabular-nums">{e.grads}</td>
                  </tr>
                ))}
                {d.breakdown.employers > d.breakdown.top.length && (
                  <tr>
                    <td colSpan={2} className="py-2 text-xs text-muted">
                      and {d.breakdown.employers - d.breakdown.top.length} more
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          {d.audience === "employers" && <p className="text-xs leading-[17px] text-muted">Employers come from alumni job records. The data holds no employer contact addresses.</p>}
        </section>

        <section aria-labelledby="sv-questions" className="flex flex-col gap-2">
          <h3 id="sv-questions" className="label text-muted">
            Questions
          </h3>
          <ol className="flex flex-col border-t border-line">
            {template?.questions.map((q, i) => (
              <li key={q.text} className="flex justify-between gap-3 border-b border-line py-2.5 text-[13px] leading-4">
                <span className="text-text">
                  <span className="mr-2 font-mono text-[11px] text-muted">{String(i + 1).padStart(2, "0")}</span>
                  {q.text}
                </span>
                <span className={cx("shrink-0 text-[11px]", q.gap ? "text-red" : "text-muted")}>{q.tag}</span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="sv-timeline" className="flex flex-col gap-2">
          <h3 id="sv-timeline" className="label text-muted">
            Timeline
          </h3>
          <ol className="relative flex flex-col gap-3 border-l border-line pl-4">
            <AnimatePresence initial={false}>
              {d.events.map((e) => (
                <motion.li key={e.id} layout initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25, ease }} className="relative flex flex-col">
                  <span aria-hidden className={cx("absolute -left-[21px] top-1.5 h-2 w-2 rounded-full border-2 border-white", e.type === "sent" ? "bg-red" : "bg-ink")} />
                  <span className="text-[13px] text-ink">{(EVENT_LABEL[e.type] ?? (() => e.type))(e.data)}</span>
                  <span className="font-mono text-[11px] tabular-nums text-muted">{fmtDateTime(e.at)} PT</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        </section>

        {d.threadId && (
          <Link to={`/a/${d.threadId}/survey`} className="text-[13px] font-medium text-ink underline decoration-1 underline-offset-[3px] hover:text-red-deep">
            Open the survey activity →
          </Link>
        )}
        {d.activityId && (
          <Link to={`/a/${d.activityId}`} className="text-[13px] text-subtle underline decoration-1 underline-offset-[3px] hover:text-ink">
            Open the program review it was sent from
          </Link>
        )}
      </div>
    </>
  );
}

/* ----------------------------------------------------------- new survey */

function NewSurvey({ programs, rows, onClose, smallN }: { programs: Program[]; rows: Row[]; onClose: () => void; smallN: number }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const hrefWith = useHrefWith();
  const fetcher = useFetcher<ActionData>({ key: "new-survey" });
  const initialProgram = programs.find((p) => p.id === params.get("program"))?.id ?? programs.find((p) => p.noJob > 0)?.id ?? programs[0]?.id ?? "";
  const [programId, setProgramId] = useState(initialProgram);
  const [audience, setAudience] = useState<Audience>(params.get("audience") === "employers" ? "employers" : "alumni");
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE[audience]);
  const p = programs.find((x) => x.id === programId);
  const t = templateById(template);
  const recipients = p ? (audience === "alumni" ? p.email : p.employers) : 0;
  const open = rows.find((r) => r.programId === programId && r.audience === audience && r.status !== "closed" && r.id > 0);
  const ids = { program: useId(), audience: useId(), template: useId() };
  const pending = fetcher.state !== "idle";
  const then = pending ? fetcher.formData?.get("then") : null;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok && fetcher.data.id) navigate(hrefWith({ new: null, program: null, audience: null, s: String(fetcher.data.id) }), { preventScrollReset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  return (
    <>
      <PanelHeader id="new-survey-title" onClose={onClose} closeLabel="Close new survey" eyebrow="New survey" title="Pick a program, an audience and a template." />
      <fetcher.Form method="post" className="flex flex-col gap-7 px-7 py-6">
        <input type="hidden" name="intent" value="create" />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.program} className="text-[13px] font-medium text-ink">
            Program
          </label>
          <select id={ids.program} name="programId" value={programId} onChange={(e) => setProgramId(e.target.value)} className={fieldCls} data-autofocus>
            {programs.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · {x.noJob} unknown jobs
              </option>
            ))}
          </select>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[13px] font-medium text-ink">Audience</legend>
          <div className="flex gap-2">
            {(["alumni", "employers"] as const).map((a) => (
              <label
                key={a}
                className={cx(
                  "flex flex-1 cursor-pointer flex-col gap-0.5 rounded-xl border px-3.5 py-3 transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink",
                  audience === a ? "border-ink" : "border-line hover:border-line-hover",
                )}
              >
                <span className="flex items-center gap-2 text-[13px] font-medium text-ink">
                  <input
                    type="radio"
                    name="audience"
                    value={a}
                    checked={audience === a}
                    onChange={() => {
                      setAudience(a);
                      setTemplate(DEFAULT_TEMPLATE[a]);
                    }}
                    className="accent-ink"
                  />
                  {AUDIENCE_LABEL[a]}
                </span>
                <span className="pl-5 text-xs text-subtle">
                  {p ? (a === "alumni" ? `${fmtNum(p.email)} with email · ${p.noJob} with no job` : `${p.employers} employers hire ${p.employedWithEmployer} grads`) : "—"}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[13px] font-medium text-ink">Template</legend>
          {templatesFor(audience).map((x) => (
            <label key={x.id} className={cx("flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px] transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink", template === x.id ? "border-ink" : "border-line hover:border-line-hover")}>
              <input type="radio" name="template" value={x.id} checked={template === x.id} onChange={() => setTemplate(x.id)} className="accent-ink" />
              <span className="grow text-ink">{x.name}</span>
              <span className="text-xs text-muted">
                {plural(x.questions.length, "question", "questions")} · ~{x.minutes} min
              </span>
            </label>
          ))}
        </fieldset>

        <section aria-labelledby="preview-title" className="flex flex-col gap-3 rounded-2xl bg-surface p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="preview-title" className="label text-muted">
              Preview
            </h3>
            <span className="font-mono text-xs tabular-nums text-ink" aria-live="polite">
              {fmtNum(recipients)} {audience === "alumni" ? "recipients with email" : "employers"} <SmallN n={recipients} min={smallN} />
            </span>
          </div>
          <ol key={template} className="flex flex-col">
              {t?.questions.map((q, i) => (
                <motion.li
                  key={`${template}-${q.text}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease, delay: i * 0.03 }}
                  className="flex justify-between gap-3 border-b border-line py-2 text-[13px] leading-4 last:border-0"
                >
                  <span className="text-text">{q.text}</span>
                  <span className={cx("shrink-0 text-[11px]", q.gap ? "text-red" : "text-muted")}>
                    {q.gap === "unknown_jobs" && p ? `fills ${p.noJob} unknown jobs` : q.gap === "missing_wages" && p ? `${p.noWage} missing wages` : q.tag}
                  </span>
                </motion.li>
              ))}
          </ol>
        </section>

        {open && (
          <p className="text-[13px] text-subtle">
            This program already has an open {audience} survey.{" "}
            <Link to={hrefWith({ new: null, s: String(open.id) })} className="text-ink underline underline-offset-[3px]">
              Open survey #{open.id}
            </Link>
          </p>
        )}
        <StatusLine tone="error" message={fetcher.data && !fetcher.data.ok ? fetcher.data.error : undefined} />
        <div className="flex gap-2">
          <ActionButton size="md" tone="ink" name="then" value="draft" pending={pending && then === "draft"} pendingLabel="Creating…" disabledReason={open ? "An open survey already exists" : undefined}>
            Create draft
          </ActionButton>
          <ActionButton size="md" tone="outline" name="then" value="send" pending={pending && then === "send"} pendingLabel="Sending…" disabledReason={open ? "An open survey already exists" : !recipients ? "No recipients on record" : undefined}>
            Create and send to {fmtNum(recipients)}
          </ActionButton>
        </div>
        <p className="text-xs leading-[17px] text-muted">Recipient counts come from alumni records. Nothing is emailed in this prototype; sending records the event and starts the simulated responses.</p>
      </fetcher.Form>
    </>
  );
}
