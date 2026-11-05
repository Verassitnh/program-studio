import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Item, PageHead, Stagger, cx, ease } from "~/components/ui";
import { syncData } from "~/lib/data.server";
import type { Route } from "./+types/onboarding.connect";

/** Setup step 1. The Lightcast local import (./data) is the real source; the other connectors are simulated. */
export const loader = () => syncData();

type Tile = { letter: string; name: string; state: "connected" | "syncing" | "idle" | "recommended" | "optional"; detail?: string };

function IntegrationTile({ t, delay }: { t: Tile; delay: number }) {
  // Raiser's Edge starts mid-sync and parks at 62% (as in the design); tiles the user connects run to completion.
  const [progress, setProgress] = useState(t.state === "syncing" ? 0.18 : 0);
  const [state, setState] = useState(t.state);
  const [detail, setDetail] = useState(t.detail);
  const cap = t.state === "syncing" ? 0.62 : 1;
  useEffect(() => {
    if (state !== "syncing") return;
    const id = setInterval(() => setProgress((p) => Math.min(cap, p + 0.04)), 120);
    return () => clearInterval(id);
  }, [state, cap]);
  useEffect(() => {
    if (state === "syncing" && progress >= 1) {
      setState("connected");
      setDetail("Demo connection");
    }
  }, [state, progress]);
  const connected = state === "connected";
  const actionable = state === "idle" || state === "recommended";
  const status = connected ? "Connected" : state === "syncing" ? `Syncing, ${Math.round(progress * 100)}%` : state === "optional" ? "Optional" : "Not connected";
  return (
    <motion.button
      type="button"
      // Non-actionable tiles stay focusable so their status is discoverable, and a tile the user just
      // connected keeps focus instead of dropping it to <body>.
      aria-disabled={actionable ? undefined : true}
      onClick={() => (actionable ? setState("syncing") : null)}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5, ease }}
      whileHover={actionable ? { y: -2 } : undefined}
      whileTap={actionable ? { scale: 0.985 } : undefined}
      className={cx(
        "flex min-w-0 flex-1 basis-0 items-center gap-2.5 rounded-xl border bg-white px-3 py-2.5 text-left transition-colors duration-300",
        actionable ? "cursor-pointer" : "cursor-default",
        connected ? "border-ink" : state === "syncing" ? "border-red" : state === "optional" ? "border-dashed border-line" : "border-line hover:border-subtle",
      )}
    >
      <div
        aria-hidden
        className={cx(
          "flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg text-xs font-semibold leading-4 transition-colors duration-300",
          connected ? "bg-ink text-white" : state === "syncing" ? "bg-red text-white" : "bg-surface text-subtle",
        )}
      >
        {t.letter}
      </div>
      <div className={cx("flex min-w-0 grow flex-col", state === "syncing" && "gap-[5px]")}>
        <div className={cx("truncate text-[13px] leading-4", connected || state === "syncing" ? "font-medium text-ink" : "text-text")}>{t.name}</div>
        <span className="sr-only">
          {status}
          {detail && state !== "syncing" ? `, ${detail}` : ""}
        </span>
        {state === "syncing" ? (
          <div aria-hidden className="h-[3px] w-full overflow-hidden rounded-[2px] bg-line">
            <motion.div className="h-[3px] rounded-[2px] bg-red" initial={false} animate={{ width: `${progress * 100}%` }} transition={{ ease: "linear", duration: 0.12 }} />
          </div>
        ) : detail ? (
          <motion.div
            key={detail}
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={cx("truncate text-[11px] leading-[14px]", state === "recommended" ? "text-red" : state === "optional" ? "text-muted" : "text-subtle")}
          >
            {detail}
          </motion.div>
        ) : null}
      </div>
      {connected && (
        <motion.div aria-hidden initial={{ scale: 0.25, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", duration: 0.3, bounce: 0 }} className="text-xs leading-4 text-ink">
          ✓
        </motion.div>
      )}
      {state === "syncing" && (
        <div aria-hidden className="font-mono text-[11px] leading-[14px] tabular-nums text-red">
          {Math.round(progress * 100)}%
        </div>
      )}
      {state === "idle" && <div className="text-xs leading-4 text-subtle">Connect</div>}
      {state === "recommended" && <div className="flex h-[26px] shrink-0 items-center rounded-full bg-ink px-2.5 text-[11px] leading-[14px] text-white">Connect</div>}
    </motion.button>
  );
}

export default function Connect({ loaderData: d }: Route.ComponentProps) {
  const rows: { title: string; sub: string; tiles: Tile[] }[] = [
    {
      title: "Student records",
      sub: "Alumni, programs, completions",
      tiles: [
        { letter: "B", name: "Ellucian Banner", state: "connected", detail: `Simulated · ${d.alumni.toLocaleString()} alumni via local import` },
        { letter: "W", name: "Workday Student", state: "idle" },
        { letter: "P", name: "PeopleSoft Campus", state: "idle" },
      ],
    },
    {
      title: "Curriculum & catalog",
      sub: "Courses, requirements, syllabi",
      tiles: [
        { letter: "C", name: "CourseLeaf", state: "connected", detail: `Simulated · ${d.courses.toLocaleString()} courses via local import` },
        { letter: "C", name: "Coursedog", state: "idle" },
        { letter: "A", name: "Acalog", state: "idle" },
      ],
    },
    {
      title: "Alumni & advancement",
      sub: "Contacts, employers, job titles",
      tiles: [
        { letter: "R", name: "Raiser's Edge NXT", state: "syncing" },
        { letter: "S", name: "Salesforce Education", state: "idle" },
        { letter: "G", name: "Graduway", state: "idle" },
      ],
    },
    {
      title: "Career services",
      sub: "Employer contacts, internships",
      tiles: [
        { letter: "H", name: "Handshake", state: "recommended", detail: "Adds employer emails" },
        { letter: "S", name: "Symplicity", state: "idle" },
        { letter: "C", name: "Canvas LMS", state: "optional", detail: "Optional · later" },
      ],
    },
  ];
  const lc = d.lightcast;
  const years = `${lc.first.slice(0, 4)}–${lc.last.slice(0, 4)}`;
  return (
    <Stagger className="flex grow flex-col gap-[26px] px-12 py-8">
      <Item className="flex items-end justify-between">
        <PageHead
          eyebrow="Setup · Step 1 · Connect sources"
          title="Sync what your school already has."
          sub={
            <span className="block leading-[18px]">
              Once for the whole school. Every program review and outcomes story then starts from this data.
            </span>
          }
        />
        <Link to="/integrations" className="text-[13px] leading-4 text-subtle underline decoration-1 underline-offset-[3px] transition-colors hover:text-ink">
          Manage sources on Integrations
        </Link>
      </Item>
      <Item className="flex flex-col border-t border-line">
        {rows.map((r, i) => (
          <div key={r.title} className="flex items-center gap-5 border-b border-line py-3.5">
            <div className="flex w-[210px] shrink-0 flex-col gap-0.5">
              <div className="text-sm font-semibold leading-[18px] text-ink">{r.title}</div>
              <div className="text-xs leading-4 text-muted">{r.sub}</div>
            </div>
            <div role="group" aria-label={r.title} className="flex min-w-0 grow gap-2.5">
              {r.tiles.map((t, j) => (
                <IntegrationTile key={t.name} t={t} delay={0.15 + i * 0.07 + j * 0.03} />
              ))}
            </div>
          </div>
        ))}
        <div className="flex items-center gap-5 py-3.5">
          <div className="flex w-[210px] shrink-0 flex-col gap-0.5">
            <div className="text-sm font-semibold leading-[18px] text-ink">Labor market</div>
            <div className="text-xs leading-4 text-muted">Postings, skills, wages</div>
          </div>
          <div className="flex grow items-center gap-2.5 rounded-xl bg-surface px-3 py-2.5">
            <div aria-hidden className="h-[30px] w-[30px] shrink-0 rounded-lg bg-red" />
            <div className="grow text-[13px] leading-4 text-ink">
              Lightcast local import · <span className="font-medium">real source</span> — {d.alumni.toLocaleString()} alumni, {d.courses.toLocaleString()} courses,{" "}
              {lc.occupations.toLocaleString()} occupations, {lc.counties} counties, {years}
            </div>
            <div className="text-xs leading-4 text-ink">
              <span aria-hidden>✓ </span>Included
            </div>
          </div>
        </div>
      </Item>
      <div className="grow" />
      <Item className="flex items-center gap-7 rounded-[14px] bg-surface px-5 py-4 text-xs leading-[17px] text-subtle">
        <div className="flex shrink-0 items-center gap-2 font-medium text-ink">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="3" y="7" width="10" height="7" rx="2" stroke="currentColor" strokeWidth="1.4" />
            <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.4" />
          </svg>
          FERPA-aware
        </div>
        <div className="flex-1">Read-only access. Student-level records stay in your tenant — dashboards show groups of 10+ only.</div>
        <div className="flex-1">
          Contacts from Raiser's Edge and Handshake power the surveys in the next stage.{" "}
          <span className="text-muted">Every connector except the Lightcast local import is simulated: records come from the example dataset in ./data.</span>
        </div>
      </Item>
    </Stagger>
  );
}
