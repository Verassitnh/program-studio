import { motion, useReducedMotion } from "motion/react";
import { Link, useParams } from "react-router";
import { Eyebrow, Item, Stagger, VBar, cx, ease } from "~/components/ui";
import { roleWord } from "~/lib/activity";
import { programOf } from "~/lib/activities.server";
import { sayData } from "~/lib/data.server";
import type { Route } from "./+types/outcomes.story";

export const loader = async ({ params }: Route.LoaderArgs) => sayData(await programOf(params));

/** Groups smaller than this get flagged (mirrors SMALL_N in data.server). */
const SMALL_N = 10;

const usd = (v: number | null) => (v == null ? "—" : `$${(Math.round(v / 100) / 10).toFixed(1)}k`);

type Col = { label: string; value: number; display: string; bar: string; tone: "muted" | "subtle" | "ink" | "red"; labelTone?: "red" };

/**
 * Column chart. `max` fixes the top of the scale (100 for percentages) so bars aren't exaggerated.
 * Screen readers get one summary (`summary`) instead of the visual pieces read out of order.
 */
function Columns({ items, max, plot = 130, height = 150, summary }: { items: Col[]; max?: number; plot?: number; height?: number; summary: string }) {
  const top = max ?? Math.max(...items.map((i) => i.value), 1);
  return (
    <div role="img" aria-label={summary} className="flex flex-col gap-2.5">
      <div aria-hidden className="flex shrink-0 items-end gap-3.5 border-b border-ink" style={{ height }}>
        {items.map((it, i) => (
          <div key={it.label} className="flex flex-1 flex-col items-center justify-end gap-1.5" style={{ height }}>
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease, delay: 0.55 + i * 0.07 }}
              className={cx(
                "font-mono text-xs leading-4",
                it.tone === "red" ? "font-semibold text-red-deep" : it.tone === "ink" ? "text-ink" : it.tone === "subtle" ? "text-subtle" : "text-subtle/85",
              )}
            >
              {it.display}
            </motion.div>
            <VBar height={it.value ? (plot * it.value) / top : 2} color={it.bar} radius={it.value ? 6 : 0} delay={0.25 + i * 0.07} />
          </div>
        ))}
      </div>
      <div aria-hidden className="flex gap-3.5 text-[11px] leading-[14px] text-subtle">
        {items.map((it) => (
          <div key={it.label} className={cx("flex-1 text-center", it.labelTone === "red" && "text-red-deep")}>
            {it.label}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The outcomes story opens here: the report itself, with the claims the data supports and the charts behind them. */
export default function Story({ loaderData: d }: Route.ComponentProps) {
  const { activityId } = useParams();
  const recent = d.cohorts.find((c) => c.cohort === "2020–25")!;
  const locTotal = d.loc.region + d.loc.elsewhere + d.loc.abroad + d.loc.unknown;
  const share = (n: number) => `${locTotal ? (100 * n) / locTotal : 0}%`;
  const matchedPct = (n: number) => (d.stats.matched ? Math.round((100 * n) / d.stats.matched) : 0);
  const small = d.cohorts.filter((c) => c.known < SMALL_N);
  const repeat = d.employers.filter((e) => e.n >= 7);
  const repeatRange = repeat.length ? `${Math.min(...repeat.map((e) => e.n))}–${Math.max(...repeat.map((e) => e.n))}` : "";
  const fast = d.within3 === 50 ? "Half were" : `${d.within3}% were`;
  const last = d.cohorts.length - 1;
  const reduce = useReducedMotion();
  const loc = [
    { n: d.loc.region, label: "NSSU region", swatch: "bg-ink" },
    { n: d.loc.elsewhere, label: "Elsewhere in US", swatch: "bg-subtle" },
    { n: d.loc.abroad, label: "Abroad", swatch: "bg-red" },
    { n: d.loc.unknown, label: "Unknown", swatch: "hatch" },
  ];

  // Only claims with data behind them; small groups say so.
  const say: [string, string][] = [
    ...(recent.known
      ? [[`${recent.pct}% of our 2020–25 grads work in their field.`, `${recent.in_field} of ${recent.known} with a known job${recent.known < SMALL_N ? " · small group" : ""}`] as [string, string]]
      : []),
    ...(d.topOcc ? [[`${d.topOcc.n} grads now work as ${d.topOcc.name.toLowerCase()}.`, `Most common job · ${matchedPct(d.topOcc.n)}% of matched alumni`] as [string, string]] : []),
    ...(d.ttj.n ? [[`${fast} hired within 3 months.`, `Median ${d.ttj.median} months · ${d.ttj.n} grads with dates${d.ttj.n < SMALL_N ? " · small group" : ""}`] as [string, string]] : []),
    ...(repeat.length ? [[`The same employers hire our grads again and again.`, `${repeat.length} employer${repeat.length === 1 ? "" : "s"} hired ${repeatRange} grads each`] as [string, string]] : []),
  ];
  const notYet: [string, string, string][] = [
    [`Pay: median ${usd(d.stats.median_wage)}`, !d.stats.wage_n
        ? "no annual wages yet →"
        : d.marketMedian != null && (d.stats.median_wage ?? 0) < d.marketMedian
          ? `below ${roleWord(d.occupation.name)} market →`
          : `vs. ${roleWord(d.occupation.name)} market →`,
      "pay",
    ],
    [`“Fast hiring” overall`, `${d.ttj.slow} took 12+ months →`, "slow"],
    [`“Most grads” claims`, `${d.stats.alumni - d.stats.matched} of ${d.stats.alumni} unknown →`, "unknown"],
  ];

  return (
    <div className="flex grow gap-9 px-12 py-[26px]">
      <Stagger className="flex grow flex-col gap-[22px]">
        <Item className="flex flex-col gap-1.5">
          <Eyebrow>Story · what you can say right now</Eyebrow>
          <h1 className="text-[28px] font-semibold leading-[34px] tracking-[-0.03em] text-ink">
            {d.stats.matched < 15 ? `${d.program.name}: too few records to say much yet.` : recent.known >= SMALL_N && recent.pct >= Math.max(...d.cohorts.filter((c) => c.known).map((c) => c.pct)) ? "The recent cohort is your best story." : `What ${d.program.short} can say today.`}
          </h1>
        </Item>
        <Item className="flex gap-7">
          <div className="flex flex-1 flex-col gap-2.5">
            <div className="text-sm font-semibold leading-[18px] text-ink">Working in field, by graduating class</div>
            <Columns
              max={100}
              summary={`Working in field, by graduating class: ${d.cohorts.map((c) => `${c.cohort}, ${c.pct}% (${c.in_field} of ${c.known})`).join("; ")}.`}
              items={d.cohorts.map((c, i) => ({
                label: `${c.cohort} · ${c.in_field}/${c.known}`,
                value: c.pct,
                display: `${c.pct}%`,
                bar: i === 0 ? "bg-line" : i === last ? "bg-red" : "bg-ink",
                tone: i === 0 ? "subtle" : i === last ? "red" : "ink",
              }))}
            />
          </div>
          <div className="flex flex-1 flex-col gap-2.5">
            <div className="text-sm font-semibold leading-[18px] text-ink">Months from graduation to first job</div>
            <Columns
              plot={110}
              summary={`Months from graduation to first job: ${d.ttjBuckets.map((b) => `${b.bucket} months, ${b.n} grads`).join("; ")}.`}
              items={d.ttjBuckets.map((b) => ({
                label: b.bucket,
                value: b.n,
                display: String(b.n),
                bar: b.bucket === "12+" ? "bg-red" : b.n ? "bg-ink" : "bg-line",
                tone: b.bucket === "12+" ? "red" : b.n ? "ink" : "muted",
                labelTone: b.bucket === "12+" ? "red" : undefined,
              }))}
            />
          </div>
        </Item>
        <Item className="flex gap-7">
          <div className="flex flex-1 flex-col gap-2.5">
            <div className="text-sm font-semibold leading-[18px] text-ink">Where alumni live now</div>
            <div aria-hidden className="flex h-7 shrink-0 gap-0.5 overflow-hidden rounded-md">
              {loc.map((l, i) => (
                <motion.div
                  key={l.label}
                  className={l.swatch}
                  initial={{ width: 0 }}
                  animate={{ width: share(l.n) }}
                  transition={reduce ? { duration: 0 } : { duration: 0.9, ease, delay: 0.3 + i * 0.08 }}
                />
              ))}
            </div>
            <ul aria-label="Where alumni live now" className="flex flex-wrap gap-3.5 text-[11px] leading-[14px] text-subtle tabular-nums">
              {loc.map((l) => (
                <li key={l.label} className="flex items-center gap-[5px]">
                  <span aria-hidden className={cx("h-2 w-2 rounded-[2px]", l.swatch)} />
                  {l.label} · {l.n}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <div className="text-sm font-semibold leading-[18px] text-ink">Employers who hired 5+ grads</div>
            <ul className="flex flex-col gap-2">
              {d.employers.map((e, i) => (
                <motion.li
                  key={e.employer}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.35 + i * 0.06, duration: 0.45, ease }}
                  className="flex justify-between border-b border-line py-[5px] text-[13px] leading-4"
                >
                  <span className="text-ink">{e.employer}</span>
                  <span className="font-mono text-ink">
                    {e.n}
                    <span className="sr-only"> grads</span>
                  </span>
                </motion.li>
              ))}
            </ul>
          </div>
        </Item>
        <Item className="mt-auto max-w-[720px] text-xs leading-[17px] text-subtle/85">
          Class bars show grads working in field / grads with a known job.
          {small.length > 0 && ` The ${small.map((c) => c.cohort).join(" and ")} classes are small (${small.map((c) => c.known).join(" and ")} grads), so read them loosely.`} Time to first
          job uses the first job start after graduation, for the {d.ttj.n} grads with dates. Source: alumni-record.json.
        </Item>
      </Stagger>
      <Stagger className="flex w-[360px] shrink-0 flex-col gap-2.5" delay={0.2}>
        <Item>
          <Eyebrow tone="ink">✓ Say it now</Eyebrow>
        </Item>
        {/* Static claims: no hover lift, so they don't read as clickable next to the links below. */}
        {say.length === 0 && (
          <Item className="rounded-xl border border-dashed border-muted px-4 py-3.5 text-[13px] leading-[19px] text-subtle">
            Nothing to claim yet: {d.stats.matched} of {d.stats.alumni} alumni have a known job. Survey alumni first.
          </Item>
        )}
        {say.map(([t, s]) => (
          <Item key={t} className="flex flex-col gap-1 rounded-xl border border-ink px-4 py-3.5">
            <p className="text-pretty text-[15px] font-semibold leading-5 text-ink">{t}</p>
            <p className="text-xs leading-4 text-subtle">{s}</p>
          </Item>
        ))}
        <Item className="pt-2.5">
          <Eyebrow>✕ Not yet — dig deeper</Eyebrow>
        </Item>
        {notYet.map(([a, b, tab]) => (
          <Item key={a}>
            <Link
              to={`/a/${activityId}/outcomes/deeper?tab=${tab}`}
              prefetch="intent"
              className="group flex justify-between gap-2.5 rounded-[10px] bg-red-soft px-3.5 py-[11px] text-[13px] leading-4 transition-colors duration-150 hover:bg-[#fde0e4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              <span className="text-ink">
                {a}
                <span className="sr-only">: </span>
              </span>
              <span className="shrink-0 text-red-deep transition-transform duration-150 ease-out group-hover:translate-x-0.5">{b}</span>
            </Link>
          </Item>
        ))}
      </Stagger>
    </div>
  );
}
