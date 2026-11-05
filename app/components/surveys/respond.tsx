import { type ReactNode, type Ref } from "react";
import { cx } from "~/components/ui";
import { type Answer, type JobAnswer, type Question, letter } from "./model";

/*
 * One question as a respondent sees it. Used by the public page (/s/:token, inside a <Form> per step, so it
 * also works without JavaScript) and by the editor's live preview (same markup, local state).
 * Every control is a native input inside its label: arrow keys move within radio groups, and the key hints
 * (A, B, C… / 1–5 / Y, N) are handled by the page.
 */

/** Keyframes the respondent views use (CSS, so they also run for server-rendered reveals). */
export function RespondStyles() {
  return (
    <style>{`
@keyframes ps-reveal { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes ps-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes ps-pop { from { transform: scale(0.6); } to { transform: scale(1); } }
`}</style>
  );
}

export function Kbd({ children, on, className }: { children: ReactNode; on?: boolean; className?: string }) {
  return (
    <kbd
      aria-hidden
      className={cx(
        "inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md border px-1.5 font-mono text-[11px] font-medium transition-colors duration-150",
        on ? "border-ink bg-ink text-white" : "border-line-hover bg-white text-subtle",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

function Tick({ on }: { on: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={cx("ml-auto shrink-0 transition-[opacity,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)]", on ? "scale-100 opacity-100" : "scale-25 opacity-0")}
    >
      <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const rowCls = (on: boolean) =>
  cx(
    "group/row relative flex min-h-[52px] w-full cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-left text-[16px] leading-[22px] transition-[border-color,background-color] duration-150",
    "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink",
    on ? "border-ink bg-surface text-ink" : "border-line bg-white text-text hover:border-line-hover hover:bg-row-hover",
  );

function ChoiceRow({
  type,
  name,
  value,
  checked,
  onChange,
  hint,
  children,
}: {
  type: "radio" | "checkbox";
  name: string;
  value: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className={rowCls(checked)} data-choice={value}>
      <input type={type} name={name} value={value} checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
      {hint && <Kbd on={checked}>{hint}</Kbd>}
      <span className="min-w-0 grow">{children}</span>
      <Tick on={checked} />
    </label>
  );
}

export const inputCls =
  "w-full rounded-xl border border-control bg-white px-4 text-[16px] text-ink placeholder:text-muted transition-colors duration-150 hover:border-ink focus-visible:border-ink";

/** The question's heading block: step eyebrow, the prompt as the page's h1, help text. */
export function StepHeading({
  eyebrow,
  title,
  help,
  id,
  headingRef,
  required,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  help?: ReactNode;
  id: string;
  headingRef?: Ref<HTMLHeadingElement>;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      {eyebrow && <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">{eyebrow}</div>}
      <h1 id={id} ref={headingRef} tabIndex={-1} className="text-[26px] font-semibold leading-[32px] tracking-[-0.02em] text-balance text-ink outline-offset-4 sm:text-[30px] sm:leading-[36px]">
        {title}
        {required && (
          <span className="ml-1.5 align-top text-[15px] font-medium text-red" aria-hidden>
            *
          </span>
        )}
        {required && <span className="sr-only"> (required)</span>}
      </h1>
      {help && <p className="text-[15px] leading-[22px] text-pretty text-subtle">{help}</p>}
    </div>
  );
}

type Props = {
  q: Question;
  answer: Answer | undefined;
  onAnswer: (a: Answer | undefined) => void;
  /** Id of the inline error, for aria-describedby. */
  errorId?: string;
  idPrefix: string;
  textRef?: Ref<HTMLInputElement & HTMLTextAreaElement>;
};

/** The answer controls for one question. Field names match answerFromForm(). */
export function QuestionBody({ q, answer, onAnswer, errorId, idPrefix, textRef }: Props) {
  const cs = q.options.choices ?? [];
  switch (q.type) {
    case "single": {
      const a = answer as { choice?: string; other?: string } | undefined;
      return (
        <fieldset className="flex flex-col gap-2" aria-labelledby={`${idPrefix}-h`} aria-describedby={errorId}>
          {cs.map((c, i) => (
            <ChoiceRow key={c.id} type="radio" name="choice" value={c.id} checked={a?.choice === c.id} onChange={() => onAnswer({ choice: c.id })} hint={letter(i)}>
              {c.label}
            </ChoiceRow>
          ))}
          {q.options.other && (
            <OtherRow
              type="radio"
              hint={letter(cs.length)}
              checked={a?.choice === "other"}
              text={a?.other ?? ""}
              onCheck={() => onAnswer({ choice: "other", other: a?.other ?? "" })}
              onText={(t) => onAnswer({ choice: "other", other: t })}
              idPrefix={idPrefix}
            />
          )}
        </fieldset>
      );
    }
    case "multi":
    case "skills": {
      const a = answer as { choices?: string[]; other?: string } | undefined;
      const picked = new Set(a?.choices ?? []);
      const set = (id: string, on: boolean) => {
        const next = new Set(picked);
        if (on) next.add(id);
        else next.delete(id);
        const choices = [...next];
        onAnswer(choices.length || a?.other ? { choices, ...(a?.other ? { other: a.other } : {}) } : undefined);
      };
      const max = q.options.max ?? 0;
      return (
        <div className="flex flex-col gap-2.5">
          <fieldset className={cx("grid gap-2", q.type === "skills" && "sm:grid-cols-2")} aria-labelledby={`${idPrefix}-h`} aria-describedby={errorId}>
            {cs.map((c, i) => (
              <ChoiceRow key={c.id} type="checkbox" name="choice" value={c.id} checked={picked.has(c.id)} onChange={(on) => set(c.id, on)} hint={i < 26 ? letter(i) : undefined}>
                {c.label}
              </ChoiceRow>
            ))}
            {q.options.other && (
              <OtherRow
                type="checkbox"
                hint={cs.length < 26 ? letter(cs.length) : undefined}
                checked={picked.has("other")}
                text={a?.other ?? ""}
                onCheck={(on) => set("other", on)}
                onText={(t) => onAnswer({ choices: [...new Set([...picked, "other"])], other: t })}
                idPrefix={idPrefix}
                wide={q.type === "skills"}
              />
            )}
          </fieldset>
          <p className="text-[13px] text-muted" aria-live="polite">
            {max ? `${picked.size} of ${max} picked` : picked.size ? `${picked.size} picked` : "Pick any that apply"}
          </p>
        </div>
      );
    }
    case "scale":
    case "nps": {
      const lo = q.type === "nps" ? 0 : Number(q.options.min ?? 1);
      const hi = q.type === "nps" ? 10 : Number(q.options.maxValue ?? 5);
      const v = (answer as { value?: number } | undefined)?.value;
      const values = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
      return (
        <fieldset className="flex flex-col gap-2.5" aria-labelledby={`${idPrefix}-h`} aria-describedby={errorId}>
          <div className={cx("grid gap-1.5", q.type === "nps" ? "grid-cols-6 sm:grid-cols-11" : values.length <= 5 ? "grid-cols-5" : "grid-cols-6 sm:grid-cols-10")}>
            {values.map((n) => {
              const on = v === n;
              const edge = n === lo ? q.options.minLabel : n === hi ? q.options.maxLabel : "";
              return (
                <label
                  key={n}
                  data-choice={String(n)}
                  className={cx(
                    "flex h-14 cursor-pointer items-center justify-center rounded-xl border font-mono text-[17px] tabular-nums transition-[border-color,background-color,color] duration-150",
                    "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink",
                    on ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:border-line-hover hover:bg-row-hover",
                  )}
                >
                  <input type="radio" name="value" value={n} checked={on} onChange={() => onAnswer({ value: n })} className="sr-only" />
                  {n}
                  {edge && <span className="sr-only">, {edge}</span>}
                </label>
              );
            })}
          </div>
          {(q.options.minLabel || q.options.maxLabel) && (
            <div className="flex justify-between gap-4 text-[13px] text-subtle" aria-hidden>
              <span>
                {lo} · {q.options.minLabel}
              </span>
              <span className="text-right">
                {hi} · {q.options.maxLabel}
              </span>
            </div>
          )}
        </fieldset>
      );
    }
    case "yesno": {
      const v = (answer as { value?: string } | undefined)?.value;
      return (
        <fieldset className="grid grid-cols-2 gap-2" aria-labelledby={`${idPrefix}-h`} aria-describedby={errorId}>
          {(["yes", "no"] as const).map((x) => (
            <ChoiceRow key={x} type="radio" name="value" value={x} checked={v === x} onChange={() => onAnswer({ value: x })} hint={x === "yes" ? "Y" : "N"}>
              {x === "yes" ? "Yes" : "No"}
            </ChoiceRow>
          ))}
        </fieldset>
      );
    }
    case "short":
      return (
        <div className="flex flex-col gap-2">
          <label htmlFor={`${idPrefix}-text`} className="sr-only">
            {q.prompt}
          </label>
          <input
            ref={textRef}
            id={`${idPrefix}-text`}
            name="text"
            type="text"
            autoComplete="off"
            value={(answer as { text?: string } | undefined)?.text ?? ""}
            onChange={(e) => onAnswer(e.target.value ? { text: e.target.value } : undefined)}
            placeholder={q.options.placeholder || "Type your answer"}
            aria-describedby={errorId}
            aria-invalid={errorId ? true : undefined}
            className={cx(inputCls, "h-14")}
          />
        </div>
      );
    case "long":
      return (
        <div className="flex flex-col gap-2">
          <label htmlFor={`${idPrefix}-text`} className="sr-only">
            {q.prompt}
          </label>
          <textarea
            ref={textRef}
            id={`${idPrefix}-text`}
            name="text"
            rows={4}
            value={(answer as { text?: string } | undefined)?.text ?? ""}
            onChange={(e) => onAnswer(e.target.value ? { text: e.target.value } : undefined)}
            placeholder={q.options.placeholder || "Type your answer"}
            aria-describedby={[errorId, `${idPrefix}-nl`].filter(Boolean).join(" ")}
            aria-invalid={errorId ? true : undefined}
            className={cx(inputCls, "min-h-32 resize-y py-3 leading-[24px]")}
          />
          <p id={`${idPrefix}-nl`} className="text-[13px] text-muted">
            <Kbd className="h-5 min-w-5 text-[10px]">Shift</Kbd> + <Kbd className="h-5 min-w-5 text-[10px]">Enter</Kbd> for a new line
          </p>
        </div>
      );
    case "job":
      return <JobBody answer={answer as JobAnswer | undefined} onAnswer={onAnswer} idPrefix={idPrefix} errorId={errorId} textRef={textRef} />;
  }
}

function OtherRow({
  type,
  hint,
  checked,
  text,
  onCheck,
  onText,
  idPrefix,
  wide,
}: {
  type: "radio" | "checkbox";
  hint?: string;
  checked: boolean;
  text: string;
  onCheck: (on: boolean) => void;
  onText: (t: string) => void;
  idPrefix: string;
  wide?: boolean;
}) {
  return (
    <div className={cx("other-row flex flex-col gap-2", wide && "sm:col-span-2")}>
      <ChoiceRow type={type} name="choice" value="other" checked={checked} onChange={onCheck} hint={hint}>
        Other
      </ChoiceRow>
      {/* Shown when "Other" is checked (CSS, so it also works before JavaScript loads). */}
      <div className="hidden pl-4 motion-safe:animate-[ps-reveal_0.25s_cubic-bezier(0.22,1,0.36,1)] [.other-row:has(input[value=other]:checked)_&]:block">
        <label htmlFor={`${idPrefix}-other`} className="sr-only">
          Other, please describe
        </label>
        <input
          id={`${idPrefix}-other`}
          name="other"
          type="text"
          value={text}
          onChange={(e) => onText(e.target.value)}
          placeholder="Please describe"
          className={cx(inputCls, "h-12")}
        />
      </div>
    </div>
  );
}

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[14px] font-medium text-ink">
        {label}
        {hint && <span className="ml-1.5 font-normal text-muted">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function Segment({ name, value, checked, onChange, children, hint }: { name: string; value: string; checked: boolean; onChange: () => void; children: ReactNode; hint?: string }) {
  return (
    <label
      className={cx(
        "flex h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 text-[15px] transition-[border-color,background-color,color] duration-150",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink",
        checked ? "border-ink bg-surface font-medium text-ink" : "border-line bg-white text-text hover:border-line-hover",
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="sr-only" data-employed={name === "employed" ? value : undefined} />
      {hint && <Kbd on={checked}>{hint}</Kbd>}
      {children}
    </label>
  );
}

/** The "Current job" block: employed? then title, employer, start month, salary + unit, related to degree. */
function JobBody({
  answer,
  onAnswer,
  idPrefix,
  errorId,
  textRef,
}: {
  answer: JobAnswer | undefined;
  onAnswer: (a: Answer | undefined) => void;
  idPrefix: string;
  errorId?: string;
  textRef?: Ref<HTMLInputElement & HTMLTextAreaElement>;
}) {
  const a: Partial<JobAnswer> = answer ?? {};
  const set = (patch: Partial<JobAnswer>) => onAnswer({ employed: "yes", unit: "year", ...a, ...patch } as JobAnswer);
  const id = (k: string) => `${idPrefix}-${k}`;
  return (
    <div className="job flex flex-col gap-6">
      <fieldset className="flex flex-col gap-2" aria-describedby={errorId}>
        <legend className="mb-2 text-[14px] font-medium text-ink">Are you working right now?</legend>
        <div className="flex gap-2">
          <Segment name="employed" value="yes" checked={a.employed === "yes"} onChange={() => onAnswer({ unit: "year", ...a, employed: "yes" } as JobAnswer)} hint="Y">
            Yes
          </Segment>
          <Segment name="employed" value="no" checked={a.employed === "no"} onChange={() => onAnswer({ employed: "no" })} hint="N">
            No
          </Segment>
        </div>
      </fieldset>
      {/* Revealed by CSS when "Yes" is checked, so the block also works without JavaScript. */}
      <div className="hidden flex-col gap-5 motion-safe:animate-[ps-reveal_0.25s_cubic-bezier(0.22,1,0.36,1)] [.job:has(input[data-employed=yes]:checked)_&]:flex">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Job title" htmlFor={id("title")}>
            <input
              ref={textRef}
              id={id("title")}
              name="title"
              type="text"
              autoComplete="organization-title"
              value={a.title ?? ""}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="e.g. Business Analyst"
              aria-describedby={errorId}
              className={cx(inputCls, "h-12")}
            />
          </Field>
          <Field label="Employer" htmlFor={id("employer")}>
            <input
              id={id("employer")}
              name="employer"
              type="text"
              autoComplete="organization"
              value={a.employer ?? ""}
              onChange={(e) => set({ employer: e.target.value })}
              placeholder="e.g. Cascade Logistics"
              className={cx(inputCls, "h-12")}
            />
          </Field>
          <Field label="Started" htmlFor={id("start")} hint="month and year">
            <input id={id("start")} name="start" type="month" value={a.start ?? ""} onChange={(e) => set({ start: e.target.value })} className={cx(inputCls, "h-12")} />
          </Field>
          <Field label="Salary" htmlFor={id("salary")} hint="optional">
            <div className="flex items-center gap-2">
              <span className="relative grow">
                <span aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[16px] text-muted">
                  $
                </span>
                <input
                  id={id("salary")}
                  name="salary"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={a.salary ?? ""}
                  onChange={(e) => set({ salary: e.target.value })}
                  placeholder={a.unit === "hour" ? "32" : "62000"}
                  className={cx(inputCls, "h-12 pl-8 tabular-nums")}
                />
              </span>
            </div>
          </Field>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[14px] font-medium text-ink">Salary is</legend>
          <div className="flex gap-2">
            <Segment name="unit" value="year" checked={(a.unit ?? "year") === "year"} onChange={() => set({ unit: "year" })}>
              Per year
            </Segment>
            <Segment name="unit" value="hour" checked={a.unit === "hour"} onChange={() => set({ unit: "hour" })}>
              Per hour
            </Segment>
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[14px] font-medium text-ink">Is it related to your degree?</legend>
          <div className="flex gap-2">
            <Segment name="related" value="yes" checked={a.related === "yes"} onChange={() => set({ related: "yes" })}>
              Yes
            </Segment>
            <Segment name="related" value="no" checked={a.related === "no"} onChange={() => set({ related: "no" })}>
              No
            </Segment>
          </div>
        </fieldset>
      </div>
    </div>
  );
}
