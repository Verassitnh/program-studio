import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Form, Link, data, redirect, useNavigation } from "react-router";
import { type Answer, answerFromForm, answerProblem, answerText, isAnswered, visibleQuestions, type Question } from "~/components/surveys/model";
import { Kbd, QuestionBody, RespondStyles, StepHeading } from "~/components/surveys/respond";
import { cx, useFirstPaint } from "~/components/ui";
import { openLink, saveAnswer, submitResponse } from "~/lib/surveys.server";
import type { Route } from "./+types/respond";

/**
 * The public respondent page, /s/:token: one private link per recipient (no sidebar, no app chrome).
 * Server-driven steps (?step=welcome | <question key> | review | done), one <Form> per step, so it works
 * without JavaScript; with it, steps slide and the keyboard drives everything. Answers save per question,
 * so reopening the link resumes where the respondent left off. Only this recipient's own answers load.
 * Opening marks the recipient Opened, the first answer Started, sending Completed.
 */

const NOINDEX = { "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" };

export const meta: Route.MetaFunction = ({ loaderData: d }) => [
  { title: d && "program" in d ? `${d.program} survey · North Sound State University` : "Survey · North Sound State University" },
  { name: "robots", content: "noindex, nofollow" },
  { name: "referrer", content: "no-referrer" },
];

type ReviewItem = { key: string; prompt: string; text: string; missing: boolean };

export async function loader({ params, request }: Route.LoaderArgs) {
  const link = await openLink(params.token);
  if (link.state === "invalid") return data({ view: "invalid" as const }, { status: 404, headers: NOINDEX });
  const base = {
    program: link.survey.programName,
    audience: link.survey.audience,
    firstName: link.firstName,
    minutes: link.survey.minutes,
  };
  if (link.state === "closed") return data({ ...base, view: "closed" as const }, { headers: NOINDEX });
  const url = new URL(request.url);
  // `sent=1` only right after submitting: the check draws then, not when a finished link is reopened.
  if (link.state === "completed") return data({ ...base, view: "done" as const, fresh: url.searchParams.has("sent") }, { headers: NOINDEX });

  const visible = visibleQuestions(link.questions, link.answers);
  const answered = visible.filter((q) => isAnswered(q, link.answers[q.key]));
  let step = url.searchParams.get("step") ?? "";
  if (step === "done") return redirect(`/s/${params.token}`); // only after a real submit
  if (!step) step = answered.length ? (visible.find((q) => !isAnswered(q, link.answers[q.key]))?.key ?? "review") : "welcome";
  if (step !== "welcome" && step !== "review" && !visible.some((q) => q.key === step)) {
    // A skipped or removed question: continue with the next visible one.
    const at = link.questions.findIndex((q) => q.key === step);
    step = visible.find((v) => link.questions.findIndex((q) => q.key === v.key) > at)?.key ?? "review";
  }
  const index = visible.findIndex((q) => q.key === step);
  const question = index >= 0 ? visible[index] : null;
  const review: ReviewItem[] =
    step === "review" ? visible.map((q) => ({ key: q.key, prompt: q.prompt, text: answerText(q, link.answers[q.key]), missing: q.required && !isAnswered(q, link.answers[q.key]) })) : [];
  const problem = url.searchParams.get("e") === "required" && question ? answerProblem(question, null) : null;
  return data(
    {
      ...base,
      view: "step" as const,
      step,
      index,
      total: visible.length,
      question,
      answer: question ? (link.answers[question.key] ?? null) : null,
      started: answered.length > 0,
      review,
      problem,
    },
    { headers: NOINDEX },
  );
}

export async function action({ params, request }: Route.ActionArgs) {
  const token = params.token;
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "next");
  const stepKey = String(fd.get("step") ?? "");
  const link = await openLink(token, { mark: false });
  if (link.state !== "open") return redirect(`/s/${token}`);
  const go = (step: string, extra = "") => redirect(`/s/${token}?step=${encodeURIComponent(step)}${extra}`);

  if (intent === "start") {
    const visible = visibleQuestions(link.questions, link.answers);
    return go(visible.find((q) => !isAnswered(q, link.answers[q.key]))?.key ?? visible[0]?.key ?? "review");
  }
  if (intent === "submit") {
    const r = await submitResponse(token);
    if (r.ok) return redirect(`/s/${token}?sent=1`);
    return r.missing ? go(r.missing, "&e=required") : redirect(`/s/${token}`);
  }
  if (intent === "review-back") {
    const visible = visibleQuestions(link.questions, link.answers);
    return go(visible[visible.length - 1]?.key ?? "welcome");
  }

  const q = link.questions.find((x) => x.key === stepKey);
  if (!q) return redirect(`/s/${token}`);
  const answer = answerFromForm(
    q,
    (n) => String(fd.get(n) ?? ""),
    (n) => fd.getAll(n).map(String),
  );
  const problem = answerProblem(q, answer);
  if (intent === "next" && problem) return data({ step: q.key, error: problem }, { status: 400 });
  const saved = await saveAnswer(token, q.key, answer);
  if (!saved.ok) return saved.state ? redirect(`/s/${token}`) : data({ step: q.key, error: saved.error }, { status: 400 });

  const answers = { ...link.answers, [q.key]: answer ?? undefined };
  const visible = visibleQuestions(link.questions, answers);
  const at = visible.findIndex((x) => x.key === q.key);
  if (intent === "back") return go(at > 0 ? visible[at - 1].key : "welcome");
  return go(visible[at + 1]?.key ?? "review");
}

/* ------------------------------------------------------------------ view */

type LoaderData = Route.ComponentProps["loaderData"];
type StepData = Extract<LoaderData, { view: "step" }>;

export default function Respond({ loaderData, actionData }: Route.ComponentProps) {
  const d = loaderData;
  if (d.view === "invalid")
    return (
      <Page>
        <Notice title="This link doesn't work" mark="?">
          It may be mistyped, or from an older invitation. If you got it by email, open it again from that email. Each link is private to one person.
        </Notice>
      </Page>
    );
  if (d.view === "closed")
    return (
      <Page>
        <Notice title="This survey has closed" mark="—">
          Thanks for wanting to help. {d.program} isn't collecting answers any more.
        </Notice>
      </Page>
    );
  if (d.view === "done") return <Done d={d} />;
  return <Steps d={d} error={actionData && "step" in actionData && actionData.step === d.step ? actionData.error : null} />;
}

function Page({ children, progress, counter }: { children: ReactNode; progress?: number; counter?: string }) {
  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <RespondStyles />
      {progress != null && (
        <div className="fixed inset-x-0 top-0 z-20 h-[3px] bg-surface" aria-hidden>
          <motion.div className="h-full origin-left bg-red" initial={false} animate={{ scaleX: progress }} transition={{ type: "spring", duration: 0.5, bounce: 0 }} />
        </div>
      )}
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 px-5 sm:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-[10px] font-semibold tracking-[0.02em] text-white">
            NS
          </span>
          <span className="truncate text-[13px] font-medium text-ink">North Sound State University</span>
          <span className="hidden truncate text-[13px] text-muted sm:inline">School of Business</span>
        </div>
        {counter && <span className="shrink-0 font-mono text-xs tabular-nums text-muted">{counter}</span>}
      </header>
      <main className="mx-auto flex w-full max-w-[640px] grow flex-col px-5 pb-16 pt-[clamp(24px,9vh,88px)] sm:px-8">{children}</main>
      <footer className="mx-auto flex w-full max-w-[640px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 pb-8 text-xs leading-[18px] text-muted sm:px-8">
        <span>Private link · don't forward it. Answers save as you go.</span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-red" />
          Survey tools by Lightcast
        </span>
      </footer>
    </div>
  );
}

function Notice({ title, children, mark }: { title: string; children: ReactNode; mark: string }) {
  return (
    <div className="flex flex-col items-start gap-5">
      <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-full bg-surface font-mono text-lg text-subtle">
        {mark}
      </span>
      <h1 className="text-[28px] font-semibold leading-[34px] tracking-[-0.02em] text-balance text-ink">{title}</h1>
      <p className="max-w-[520px] text-[16px] leading-[24px] text-pretty text-subtle">{children}</p>
    </div>
  );
}

/* ---------------------------------------------------------------- steps */

function progressOf(d: StepData) {
  if (d.step === "welcome") return 0.02;
  if (d.step === "review") return d.total / (d.total + 1);
  return Math.max(0.04, d.index / (d.total + 1));
}

function Steps({ d, error }: { d: StepData; error: string | null }) {
  const order = d.step === "welcome" ? -1 : d.step === "review" ? 1e6 : d.index;
  const prev = useRef(order);
  const dir = order >= prev.current ? 1 : -1;
  useEffect(() => {
    prev.current = order;
  }, [order]);
  const label = d.step === "welcome" ? "Welcome" : d.step === "review" ? "Review your answers" : `Question ${d.index + 1} of ${d.total}`;
  return (
    <Page progress={progressOf(d)} counter={d.index >= 0 ? `${d.index + 1} / ${d.total}` : undefined}>
      {/* Announces each step; mounted once so updates are read. */}
      <div role="status" aria-live="polite" className="sr-only">
        {label}
      </div>
      <div className="relative grow">
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div
            key={d.step}
            custom={dir}
            variants={{
              enter: (k: number) => ({ opacity: 0, y: 28 * k }),
              center: { opacity: 1, y: 0, transition: { type: "spring", duration: 0.28, bounce: 0 } },
              exit: (k: number) => ({ opacity: 0, y: -16 * k, transition: { duration: 0.15, ease: "easeOut" } }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            className="w-full"
          >
            {d.step === "welcome" ? <Welcome d={d} /> : d.step === "review" ? <Review d={d} /> : <QuestionStep d={d} error={error} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </Page>
  );
}

/** Moves focus to the new step's heading (not on the first, server-rendered paint). */
function useStepFocus() {
  const ref = useRef<HTMLHeadingElement>(null);
  const first = useFirstPaint();
  useEffect(() => {
    if (!first) ref.current?.focus({ preventScroll: true });
  }, [first]);
  return ref;
}

function Continue({ children = "Continue", value = "next", pending }: { children?: ReactNode; value?: string; pending?: boolean }) {
  return (
    <button
      type="submit"
      name="intent"
      value={value}
      data-primary
      aria-disabled={pending || undefined}
      className={cx(
        "inline-flex h-12 items-center gap-2.5 rounded-full bg-ink pl-6 pr-5 text-[15px] font-medium text-white transition-[background-color,scale] duration-150 ease-out hover:bg-ink-hover",
        !pending && "active:scale-[0.96]",
        pending && "cursor-progress",
      )}
    >
      {children}
      <span aria-hidden className="font-mono text-[13px] text-white/60">
        ↵
      </span>
    </button>
  );
}

function EnterHint() {
  return (
    <span className="hidden items-center gap-1.5 text-[13px] text-muted [@media(hover:hover)]:inline-flex" aria-hidden>
      or press <Kbd className="h-5 min-w-5 text-[10px]">Enter</Kbd>
    </span>
  );
}

function Welcome({ d }: { d: StepData }) {
  const ref = useStepFocus();
  const nav = useNavigation();
  const alumni = d.audience === "alumni";
  const hi = d.firstName ? `Hi ${d.firstName}. ` : "Hi. ";
  useSubmitKeys(null);
  return (
    <Form method="post" className="flex flex-col gap-8">
      <StepHeading
        id="welcome-h"
        headingRef={ref}
        eyebrow={`${d.program} · ${alumni ? "Alumni" : "Employer"} survey`}
        title={alumni ? `${hi}Where did ${d.program} take you?` : `${hi}Which skills should ${d.program} grads bring?`}
        help={
          alumni
            ? "A few quick questions about what you're doing now. Your answers help NSSU students choose with real data."
            : "A few quick questions about what your team needs from new hires, so the program can teach it."
        }
      />
      <ul className="flex flex-wrap gap-2 text-[13px] text-subtle">
        {[`About ${d.minutes} minute${d.minutes === 1 ? "" : "s"}`, `${d.total} question${d.total === 1 ? "" : "s"}`, "Saves as you go"].map((t) => (
          <li key={t} className="rounded-full bg-surface px-3 py-1.5">
            {t}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-4">
        <Continue value="start" pending={nav.state !== "idle"}>
          {d.started ? "Continue where you left off" : "Start"}
        </Continue>
        <EnterHint />
      </div>
      <p className="max-w-[520px] border-t border-line pt-5 text-[13px] leading-[19px] text-pretty text-muted">
        <span className="font-medium text-subtle">How your answers are used. </span>
        {alumni
          ? "North Sound State's School of Business reports them in aggregate to show where graduates work. Your job details update your own alumni record. Other alumni never see your answers."
          : "North Sound State's School of Business reads them to plan courses and internships, and reports them in aggregate. Other employers never see your answers."}
      </p>
    </Form>
  );
}

/** Enter submits the step's primary action from anywhere but a button, link or (without Shift) a textarea. */
function useSubmitKeys(onKey: ((e: KeyboardEvent, form: HTMLFormElement) => void) | null) {
  const present = useIsPresent();
  const cb = useRef(onKey);
  cb.current = onKey;
  useEffect(() => {
    if (!present) return;
    const h = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      const form = document.querySelector<HTMLFormElement>("form[data-step-form]") ?? document.querySelector<HTMLFormElement>("main form");
      if (!form) return;
      const el = document.activeElement as HTMLElement | null;
      if (e.key === "Enter") {
        if (el && (el.tagName === "BUTTON" || el.tagName === "A")) return;
        if (el?.tagName === "TEXTAREA" && e.shiftKey) return;
        e.preventDefault();
        form.requestSubmit(form.querySelector<HTMLButtonElement>("[data-primary]") ?? undefined);
        return;
      }
      cb.current?.(e, form);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [present]);
}

const isTyping = (el: Element | null) =>
  !!el && (el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el.tagName === "INPUT" && !["radio", "checkbox", "button", "submit"].includes((el as HTMLInputElement).type)));

function QuestionStep({ d, error }: { d: StepData; error: string | null }) {
  const q = d.question as Question;
  const [answer, setAnswer] = useState<Answer | undefined>((d.answer as Answer | null) ?? undefined);
  const ref = useStepFocus();
  const textRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const nav = useNavigation();
  const pending = nav.state !== "idle";
  const uid = useId();
  const idPrefix = `q${uid.replace(/[^a-z0-9]/gi, "")}`;
  const shownError = error ?? d.problem;
  // Clear a stale message once the respondent changes the answer.
  const [dirty, setDirty] = useState(false);
  const message = dirty ? null : shownError;
  const errorId = message ? `${idPrefix}-err` : undefined;

  useSubmitKeys((e, form) => {
    const el = document.activeElement;
    if (e.key === "ArrowLeft" && !isTyping(el) && (el as HTMLInputElement | null)?.type !== "radio") {
      e.preventDefault();
      form.requestSubmit(form.querySelector<HTMLButtonElement>("[data-back]") ?? undefined);
      return;
    }
    if (isTyping(el)) return;
    const k = e.key.length === 1 ? e.key.toUpperCase() : "";
    if (!k) return;
    const inputs = [...form.querySelectorAll<HTMLInputElement>("label[data-choice] input")];
    let target: HTMLInputElement | undefined;
    if (q.type === "single" || q.type === "multi" || q.type === "skills") {
      const i = k.charCodeAt(0) - 65;
      if (k.length === 1 && i >= 0 && i < 26) target = inputs[i];
    } else if (q.type === "scale" || q.type === "nps") {
      target = form.querySelector<HTMLInputElement>(`label[data-choice="${k}"] input`) ?? undefined;
    } else if (q.type === "yesno") {
      if (k === "Y" || k === "N") target = form.querySelector<HTMLInputElement>(`input[name=value][value=${k === "Y" ? "yes" : "no"}]`) ?? undefined;
    } else if (q.type === "job") {
      if (k === "Y" || k === "N") target = form.querySelector<HTMLInputElement>(`input[name=employed][value=${k === "Y" ? "yes" : "no"}]`) ?? undefined;
    }
    if (target) {
      e.preventDefault();
      target.click();
      target.focus({ preventScroll: true });
      return;
    }
    // Typing while the heading has focus goes straight into the text field.
    if ((q.type === "short" || q.type === "long") && el === ref.current) textRef.current?.focus();
  });

  return (
    <Form method="post" data-step-form className="flex flex-col gap-8" noValidate>
      <input type="hidden" name="step" value={q.key} />
      <StepHeading
        id={`${idPrefix}-h`}
        headingRef={ref}
        eyebrow={`Question ${d.index + 1} of ${d.total}`}
        title={q.prompt}
        help={q.help || undefined}
        required={q.required}
      />
      <div
        onChange={() => setDirty(true)}
        className="flex flex-col gap-3"
      >
        <QuestionBody
          q={q}
          answer={answer}
          onAnswer={(a) => {
            setAnswer(a);
            setDirty(true);
          }}
          idPrefix={idPrefix}
          errorId={errorId}
          textRef={textRef}
        />
        <div id={errorId} role="alert" className="min-h-5 text-[14px] leading-5 text-red">
          {message && (
            <motion.span initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="inline-flex items-center gap-1.5">
              <span aria-hidden>↑</span>
              {message}
            </motion.span>
          )}
        </div>
      </div>
      {/* Continue comes first in the DOM, so pressing Enter in a field submits it, not Back. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Continue pending={pending}>{d.index + 1 === d.total ? "Review answers" : q.required ? "Continue" : isAnswered(q, answer) ? "Continue" : "Skip"}</Continue>
        <EnterHint />
        <button
          type="submit"
          name="intent"
          value="back"
          data-back
          formNoValidate
          className="order-first -ml-3 inline-flex h-12 items-center gap-1.5 rounded-full px-3 text-[14px] text-subtle transition-[color,background-color] duration-150 hover:bg-surface hover:text-ink"
        >
          <span aria-hidden>←</span> Back
        </button>
      </div>
    </Form>
  );
}

function Review({ d }: { d: StepData }) {
  const ref = useStepFocus();
  const nav = useNavigation();
  const missing = d.review.filter((r) => r.missing).length;
  useSubmitKeys(null);
  return (
    <Form method="post" data-step-form className="flex flex-col gap-8">
      <StepHeading
        id="review-h"
        headingRef={ref}
        eyebrow="Last step"
        title="Check your answers"
        help={missing ? `${missing === 1 ? "One question needs" : `${missing} questions need`} an answer before you send.` : "Change anything you like, then send. You can't edit after sending."}
      />
      <ol className="flex flex-col border-t border-line">
        {d.review.map((r, i) => (
          <li key={r.key} className="flex items-start gap-4 border-b border-line py-4">
            <span className="w-6 shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-muted">{String(i + 1).padStart(2, "0")}</span>
            <div className="flex min-w-0 grow flex-col gap-1">
              <span className="text-[14px] leading-5 text-subtle">{r.prompt}</span>
              <span className={cx("text-[16px] leading-[22px] break-words", r.missing ? "text-red" : r.text ? "text-ink" : "text-muted")}>
                {r.missing ? "Needs an answer" : r.text || "Skipped"}
              </span>
            </div>
            <Link
              to={`?step=${encodeURIComponent(r.key)}`}
              className="-mr-2 shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium text-ink underline decoration-line-hover underline-offset-4 transition-colors duration-150 hover:bg-surface hover:decoration-ink"
              aria-label={`Edit: ${r.prompt}`}
            >
              Edit
            </Link>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Continue value="submit" pending={nav.state !== "idle"}>
          Send my answers
        </Continue>
        <EnterHint />
        <button
          type="submit"
          name="intent"
          value="review-back"
          className="order-first -ml-3 inline-flex h-12 items-center gap-1.5 rounded-full px-3 text-[14px] text-subtle transition-[color,background-color] duration-150 hover:bg-surface hover:text-ink"
        >
          <span aria-hidden>←</span> Back
        </button>
      </div>
    </Form>
  );
}

function Done({ d }: { d: Extract<LoaderData, { view: "done" }> }) {
  const ref = useStepFocus();
  const draw = d.fresh;
  return (
    <Page progress={1}>
      <div className="flex flex-col items-start gap-6">
        <svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden className={cx(draw && "motion-safe:animate-[ps-pop_0.4s_cubic-bezier(0.22,1,0.36,1)_both]")}>
          <circle cx="28" cy="28" r="27" fill="var(--color-ink)" />
          <path
            d="M17 29l7.5 7.5L39.5 21"
            stroke="#fff"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray="1"
            className={cx(draw && "animate-[ps-draw_0.45s_cubic-bezier(0.22,1,0.36,1)_0.15s_both]")}
          />
        </svg>
        <div className="flex flex-col gap-3">
          <h1 ref={ref} tabIndex={-1} className="text-[30px] font-semibold leading-[36px] tracking-[-0.02em] text-balance text-ink outline-offset-4">
            Thank you{d.firstName ? `, ${d.firstName}` : ""}.
          </h1>
          <p className="max-w-[520px] text-[17px] leading-[26px] text-pretty text-text">
            {d.fresh ? "" : "Your answers are already in. "}Your answers help NSSU students choose with real data.
          </p>
          <p className="text-[14px] leading-5 text-muted">You can close this tab.</p>
        </div>
      </div>
    </Page>
  );
}
