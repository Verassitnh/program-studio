import { motion } from "motion/react";
import { useState } from "react";
import { Form, useActionData, useNavigation } from "react-router";
import { Check, Item, PageHead, Sparkle, Stagger, cx, ease } from "~/components/ui";
import { gapPrograms } from "~/lib/onboarding.server";
import { listSurveys } from "~/lib/workspace.server";
import type { Route } from "./+types/onboarding.surveys";

/**
 * Setup step 3: fill the gaps with surveys, school-wide. Programs with the most alumni with no job on record
 * come first and the top five are picked. "Send surveys & finish" (the stage bar CTA, form="send-surveys")
 * creates and sends them through the Surveys API; each sent survey is its own activity. Recipients are real
 * counts; responses are simulated (demo).
 */
export async function loader() {
  const [programs, surveys] = await Promise.all([gapPrograms(), listSurveys()]);
  const out = Object.fromEntries(surveys.filter((s) => s.status === "sent" || s.status === "scheduled").map((s) => [`${s.programId}:${s.audience}`, s.status]));
  return { programs, out };
}

const DEFAULT_PICKS = 5;

const QUESTIONS = {
  alumni: ["Confirm your current job title and employer", "Which courses do you actually use at work?", "What got you hired?", "Salary range (optional)"],
  employers: ["Which 3 skills mattered most in their first year?", "What did they learn on the job that school should teach?", "Would you hire another grad this year?"],
};

export default function Surveys({ loaderData: { programs, out } }: Route.ComponentProps) {
  const [picked, setPicked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(programs.slice(0, DEFAULT_PICKS).flatMap((p) => [[`${p.id}:alumni`, !out[`${p.id}:alumni`]]])),
  );
  const result = useActionData<{ ok: boolean; error?: string }>();
  const nav = useNavigation();
  const toggle = (k: string) => setPicked((s) => ({ ...s, [k]: !s[k] }));
  const count = Object.values(picked).filter(Boolean).length;
  const unknown = programs.reduce((s, p) => s + p.unknown, 0);
  return (
    <Stagger className="flex grow flex-col gap-6 px-12 py-8">
      <PageHead
        eyebrow="Setup · Step 3 · Fill the gaps"
        title="Survey the programs with the most unknowns."
        sub={
          <span className="block leading-[18px]">
            {unknown.toLocaleString()} business alumni have no job on record across {programs.length} programs. The top {Math.min(DEFAULT_PICKS, programs.length)} are picked; change
            anything, then send.
          </span>
        }
      />
      <Form id="send-surveys" method="post" action="/onboarding" className="flex gap-8">
        <input type="hidden" name="intent" value="send" />
        {Object.entries(picked)
          .filter(([, v]) => v)
          .map(([k]) => (
            <input key={k} type="hidden" name="pick" value={k} />
          ))}
        <Item className="flex min-w-0 flex-[1.4] flex-col">
          <table className="w-full text-left text-[13px]">
            <caption className="sr-only">Programs with alumni who have no job on record</caption>
            <thead className="label text-[10px] text-muted">
              <tr className="h-8 border-b border-line">
                <th scope="col" className="font-normal">Program</th>
                <th scope="col" className="w-24 text-right font-normal">No job</th>
                <th scope="col" className="w-24 text-right font-normal">Reachable</th>
                <th scope="col" className="w-24 text-center font-normal">Alumni</th>
                <th scope="col" className="w-24 text-center font-normal">Employers</th>
              </tr>
            </thead>
            <tbody>
              {programs.slice(0, 12).map((p, i) => (
                <motion.tr
                  key={p.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + i * 0.03, duration: 0.35, ease }}
                  className="h-11 border-b border-line"
                >
                  <th scope="row" className="truncate pr-3 font-normal text-ink">
                    {p.name}
                    {p.alumni < 15 && <span className="ml-2 text-xs text-muted">small program</span>}
                  </th>
                  <td className="text-right font-mono tabular-nums text-red-deep">{p.unknown}</td>
                  <td className="text-right font-mono tabular-nums text-subtle">{p.reachable}</td>
                  {(["alumni", "employers"] as const).map((aud) => {
                    const k = `${p.id}:${aud}`;
                    return (
                      <td key={aud} className="text-center">
                        {out[k] ? (
                          <span className="text-xs text-subtle">{out[k] === "sent" ? "Sent" : "Scheduled"}</span>
                        ) : (
                          <span className="inline-flex">
                            <Check on={!!picked[k]} onClick={() => toggle(k)} label={`Survey ${aud} of ${p.name}`} />
                          </span>
                        )}
                      </td>
                    );
                  })}
                </motion.tr>
              ))}
            </tbody>
          </table>
          {programs.length > 12 && <p className="pt-2 text-xs text-muted">{programs.length - 12} more programs with fewer unknowns are on the Surveys page.</p>}
        </Item>
        <Item className="flex flex-1 flex-col gap-4">
          {(["alumni", "employers"] as const).map((aud) => (
            <div key={aud} className="flex flex-col gap-2 rounded-[14px] border border-line p-4">
              <div className="text-sm font-semibold text-ink">{aud === "alumni" ? "Alumni survey" : "Employer survey"} · ~{aud === "alumni" ? 2 : 3} min</div>
              <ul className="flex flex-col gap-1 text-xs leading-4 text-subtle">
                {QUESTIONS[aud].map((q) => (
                  <li key={q}>· {q}</li>
                ))}
              </ul>
            </div>
          ))}
          <div className="flex gap-2.5 rounded-[14px] bg-surface px-4 py-3 text-[13px] leading-[19px] text-text">
            <Sparkle className="mt-[3px]" />
            <span>
              {count ? `${count} survey${count === 1 ? "" : "s"} will go out now.` : "Nothing picked: finishing skips surveys."} Each sent survey becomes an activity in the sidebar; responses are
              simulated (demo).
            </span>
          </div>
        </Item>
      </Form>
      <div role="status" className="text-[13px] text-subtle">
        {nav.state === "submitting" ? "Sending surveys…" : result?.error ? <span className="text-red-deep">{result.error}</span> : ""}
      </div>
      <Item className="mt-auto text-xs leading-4 text-muted">Audience sizes are counted from your records. Response counts shown after sending are simulated for this demo.</Item>
    </Stagger>
  );
}
