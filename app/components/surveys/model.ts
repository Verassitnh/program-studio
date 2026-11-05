/*
 * Survey questions: types, templates, validation and skip logic. Client-safe (no database access); shared by
 * the question editor, the public respondent page (/s/:token), results and app/lib/surveys.server.ts.
 */
import type { Audience } from "~/components/workspace/model";

export type QType = "single" | "multi" | "scale" | "nps" | "yesno" | "short" | "long" | "job" | "skills";
export type Choice = { id: string; label: string };

export type QOptions = {
  /** single, multi, skills */
  choices?: Choice[];
  /** single, multi, skills: adds an "Other" choice with a text field. */
  other?: boolean;
  /** multi, skills: most picks allowed (0 = any). */
  max?: number;
  /** scale */
  min?: number;
  maxValue?: number;
  /** scale, nps */
  minLabel?: string;
  maxLabel?: string;
  /** short, long */
  placeholder?: string;
};

/** Skip this question when an earlier question has this answer. */
export type Logic = { skip_if: { question: string; answer: string } } | null;

export type Question = {
  key: string;
  type: QType;
  prompt: string;
  help: string;
  required: boolean;
  options: QOptions;
  logic: Logic;
};

export const TYPE_META: Record<QType, { label: string; short: string; hint: string; audience?: Audience }> = {
  single: { label: "Single choice", short: "Choice", hint: "Pick one" },
  multi: { label: "Multiple choice", short: "Choices", hint: "Pick any" },
  scale: { label: "Rating scale", short: "Rating", hint: "1 to 5" },
  nps: { label: "Recommend score", short: "NPS", hint: "0 to 10" },
  yesno: { label: "Yes or no", short: "Yes/No", hint: "Two buttons" },
  short: { label: "Short text", short: "Short text", hint: "One line" },
  long: { label: "Long text", short: "Long text", hint: "A paragraph" },
  job: { label: "Current job", short: "Job", hint: "Fills unknown outcomes", audience: "alumni" },
  skills: { label: "Skills you hire for", short: "Skills", hint: "From real postings", audience: "employers" },
};

export const TYPE_ORDER: QType[] = ["single", "multi", "scale", "nps", "yesno", "short", "long", "job", "skills"];

/* ---------------------------------------------------------------- ids */

export function uid(n = 8) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}

const choices = (labels: string[]): Choice[] => labels.map((label) => ({ id: uid(6), label }));

/* ---------------------------------------------------------- templates */

/** Real program context the templates draw on: course names and the target occupation's benchmark skills. */
export type TemplateContext = {
  programName: string;
  courses: { code: string; name: string }[];
  skills: { id: string; name: string }[];
  occupation: string;
};

export type SurveyTemplate = { id: string; audience: Audience | "any"; name: string; blurb: string };

/** Ids match studio.surveys.template (the earlier templates) plus "blank". */
export const SURVEY_TEMPLATES: SurveyTemplate[] = [
  { id: "alumni-outcomes", audience: "alumni", name: "Alumni outcomes", blurb: "Current job, courses used, how they got hired" },
  { id: "alumni-job-update", audience: "alumni", name: "Alumni job update (short)", blurb: "Just the current job block" },
  { id: "employer-skills", audience: "employers", name: "Employer skills needs", blurb: "Skills that matter, gaps, hiring intent" },
  { id: "employer-pulse", audience: "employers", name: "Employer hiring pulse (short)", blurb: "Would you hire, would you host an intern" },
  { id: "blank", audience: "any", name: "Blank", blurb: "Start with one question and build your own" },
];

export const surveyTemplate = (id: string) => SURVEY_TEMPLATES.find((t) => t.id === id);
export const templatesForAudience = (a: Audience) => SURVEY_TEMPLATES.filter((t) => t.audience === a || t.audience === "any");

export function newQuestion(type: QType, ctx?: TemplateContext): Question {
  const base = { key: uid(), type, help: "", required: false, logic: null as Logic };
  switch (type) {
    case "single":
      return { ...base, prompt: "", options: { choices: choices(["Option 1", "Option 2", "Option 3"]) } };
    case "multi":
      return { ...base, prompt: "", options: { choices: choices(["Option 1", "Option 2", "Option 3"]) } };
    case "scale":
      return { ...base, prompt: "", options: { min: 1, maxValue: 5, minLabel: "Not at all", maxLabel: "Extremely" } };
    case "nps":
      return { ...base, prompt: `How likely are you to recommend ${ctx?.programName ?? "this program"} to a friend?`, options: { minLabel: "Not likely", maxLabel: "Very likely" } };
    case "yesno":
      return { ...base, prompt: "", options: {} };
    case "short":
      return { ...base, prompt: "", options: { placeholder: "" } };
    case "long":
      return { ...base, prompt: "", options: { placeholder: "" } };
    case "job":
      return { ...base, prompt: "What are you doing now?", help: "This updates your alumni record, so the program's outcomes stay accurate.", required: true, options: {} };
    case "skills":
      return {
        ...base,
        prompt: "Which skills do you hire for?",
        help: ctx?.occupation ? `From ${ctx.occupation} job postings in King County. Pick up to 3.` : "Pick up to 3.",
        options: { choices: (ctx?.skills ?? []).map((s) => ({ id: s.id, label: s.name })), other: true, max: 3 },
      };
  }
}

/** Builds a template's questions from the program's real courses and benchmark skills. */
export function buildTemplate(id: string, ctx: TemplateContext): Question[] {
  const q = (type: QType, patch: Partial<Question> = {}): Question => ({ ...newQuestion(type, ctx), ...patch });
  const courseChoices = ctx.courses.length
    ? [...ctx.courses.map((c) => `${c.code} ${c.name}`), "None of these"]
    : ["Analytics and data", "Communication", "Finance and accounting", "Management", "None of these"];
  switch (id) {
    case "alumni-outcomes": {
      const job = q("job", { prompt: "Confirm your current job title and employer" });
      return [
        job,
        q("multi", {
          prompt: "Which courses do you actually use at work?",
          help: "Pick any that apply.",
          options: { choices: choices(courseChoices) },
          logic: { skip_if: { question: job.key, answer: "not_employed" } },
        }),
        q("single", {
          prompt: "What got you hired?",
          options: { choices: choices(["An internship", "A referral or my network", "A campus career fair", "Applying online", "A recruiter reached out"]), other: true },
          logic: { skip_if: { question: job.key, answer: "not_employed" } },
        }),
        q("long", { prompt: "Anything you wish the program had taught you?", options: { placeholder: "A skill, a tool, a kind of project…" } }),
      ];
    }
    case "alumni-job-update":
      return [q("job", { prompt: "Confirm your current job title and employer" })];
    case "employer-skills":
      return [
        q("skills", { prompt: "Which 3 skills mattered most in their first year?", required: true }),
        q("long", { prompt: "What did they learn on the job that school should teach?", options: { placeholder: "e.g. Building a forecast in Excel from messy data" } }),
        q("yesno", { prompt: "Would you hire another grad this year?", required: true }),
        q("yesno", { prompt: "Would you host an intern next year?" }),
        q("short", { prompt: "Which tools should new hires already know?", options: { placeholder: "e.g. Excel, Tableau, Salesforce" } }),
      ];
    case "employer-pulse":
      return [q("yesno", { prompt: "Would you hire another grad this year?", required: true }), q("yesno", { prompt: "Would you host an intern next year?" })];
    default:
      return [q("short", { prompt: "" })];
  }
}

/* -------------------------------------------------------- validation */

export type QuestionIssue = { key: string; field: "prompt" | "choices" | "logic" | "scale"; message: string; choiceId?: string };

export function validateQuestions(qs: Question[]): { ok: boolean; issues: QuestionIssue[]; summary: string | null } {
  const issues: QuestionIssue[] = [];
  qs.forEach((q, i) => {
    if (!q.prompt.trim()) issues.push({ key: q.key, field: "prompt", message: "Write the question." });
    if (q.type === "single" || q.type === "multi" || q.type === "skills") {
      const cs = q.options.choices ?? [];
      if (cs.length + (q.options.other ? 1 : 0) < (q.type === "single" ? 2 : 1))
        issues.push({ key: q.key, field: "choices", message: q.type === "single" ? "Add at least 2 options." : "Add at least 1 option." });
      for (const c of cs) if (!c.label.trim()) issues.push({ key: q.key, field: "choices", choiceId: c.id, message: "Give this option a label or remove it." });
    }
    if (q.type === "scale" && !(Number(q.options.maxValue ?? 5) > Number(q.options.min ?? 1)))
      issues.push({ key: q.key, field: "scale", message: "The scale needs at least two points." });
    if (q.logic?.skip_if) {
      const at = qs.findIndex((x) => x.key === q.logic!.skip_if.question);
      if (at < 0 || at >= i) issues.push({ key: q.key, field: "logic", message: "Skip logic must point to an earlier question." });
    }
  });
  const summary = !qs.length
    ? "Add at least one question."
    : issues.length
      ? `${issues.length === 1 ? "1 thing needs" : `${issues.length} things need`} fixing in the questions.`
      : null;
  return { ok: !summary, issues, summary };
}

/** Answers a skip rule can test, per question type. */
export function logicAnswers(q: Question): { value: string; label: string }[] {
  switch (q.type) {
    case "yesno":
      return [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ];
    case "job":
      return [
        { value: "not_employed", label: "Not employed" },
        { value: "employed", label: "Employed" },
      ];
    case "single":
      return (q.options.choices ?? []).map((c) => ({ value: c.id, label: c.label || "Untitled option" }));
    default:
      return [];
  }
}

/* --------------------------------------------------------- answering */

/** Stored answer shapes (studio.survey_answers.value). */
export type JobAnswer = { employed: "yes" | "no"; title?: string; employer?: string; start?: string; salary?: string; unit?: "year" | "hour"; related?: "yes" | "no" };
export type Answer =
  | { choice: string; other?: string } // single
  | { choices: string[]; other?: string } // multi, skills
  | { value: number } // scale, nps
  | { value: "yes" | "no" } // yesno
  | { text: string } // short, long
  | JobAnswer;

export type Answers = Record<string, Answer | undefined>;

/** Whether an answer matches a skip rule's value. */
function matches(q: Question, a: Answer | undefined, answer: string) {
  if (!a) return false;
  if (q.type === "job") return answer === "not_employed" ? (a as JobAnswer).employed === "no" : (a as JobAnswer).employed === "yes";
  if (q.type === "yesno") return (a as { value: string }).value === answer;
  if (q.type === "single") return (a as { choice: string }).choice === answer;
  return false;
}

/** The questions a respondent sees, in order, given their answers so far (skip logic applied). */
export function visibleQuestions(qs: Question[], answers: Answers) {
  const shown = new Set<string>();
  const out: Question[] = [];
  for (const q of qs) {
    const rule = q.logic?.skip_if;
    if (rule) {
      const src = qs.find((x) => x.key === rule.question);
      // A rule on a question that was itself skipped never fires.
      if (src && shown.has(src.key) && matches(src, answers[src.key], rule.answer)) continue;
    }
    shown.add(q.key);
    out.push(q);
  }
  return out;
}

export function isAnswered(q: Question, a: Answer | undefined) {
  if (!a) return false;
  switch (q.type) {
    case "single":
      return !!(a as { choice?: string }).choice;
    case "multi":
    case "skills":
      return ((a as { choices?: string[] }).choices?.length ?? 0) > 0 || !!(a as { other?: string }).other?.trim();
    case "scale":
    case "nps":
      return Number.isFinite((a as { value?: number }).value);
    case "yesno":
      return (a as { value?: string }).value === "yes" || (a as { value?: string }).value === "no";
    case "short":
    case "long":
      return !!(a as { text?: string }).text?.trim();
    case "job": {
      const j = a as JobAnswer;
      return j.employed === "no" || (j.employed === "yes" && !!j.title?.trim());
    }
  }
}

/** A short, readable version of an answer (review step, results lists). */
export function answerText(q: Question, a: Answer | undefined): string {
  if (!a || !isAnswered(q, a)) return "";
  const label = (id: string) => q.options.choices?.find((c) => c.id === id)?.label ?? id;
  switch (q.type) {
    case "single": {
      const s = a as { choice: string; other?: string };
      return s.choice === "other" ? `Other: ${s.other ?? ""}` : label(s.choice);
    }
    case "multi":
    case "skills": {
      const m = a as { choices: string[]; other?: string };
      return [...(m.choices ?? []).filter((c) => c !== "other").map(label), ...(m.other?.trim() ? [`Other: ${m.other.trim()}`] : [])].join(", ");
    }
    case "scale":
    case "nps":
      return String((a as { value: number }).value);
    case "yesno":
      return (a as { value: string }).value === "yes" ? "Yes" : "No";
    case "short":
    case "long":
      return (a as { text: string }).text;
    case "job": {
      const j = a as JobAnswer;
      if (j.employed === "no") return "Not employed right now";
      const pay = j.salary ? ` · $${Number(j.salary).toLocaleString("en-US")}${j.unit === "hour" ? "/hr" : "/yr"}` : "";
      const since = j.start ? ` · since ${fmtMonth(j.start)}` : "";
      return `${j.title}${j.employer ? ` at ${j.employer}` : ""}${since}${pay}${j.related ? ` · ${j.related === "yes" ? "related" : "not related"} to degree` : ""}`;
    }
  }
}

const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
export const fmtMonth = (ym: string) => (/^\d{4}-\d{2}$/.test(ym) ? monthFmt.format(new Date(`${ym}-01T00:00:00Z`)) : ym);

/** Rough answering time: about 12s per tap question, 30s per text box, 45s for the job block. */
export function estimateMinutes(qs: Question[]) {
  const s = qs.reduce((t, q) => t + (q.type === "job" ? 45 : q.type === "long" ? 40 : q.type === "short" ? 20 : 12), 20);
  return Math.max(1, Math.round(s / 60));
}

/** Choice key hints: A, B, C … */
export const letter = (i: number) => String.fromCharCode(65 + i);

/* ------------------------------------------------------------ message */

export type Message = { subject: string; intro: string; sender: string };

export function defaultMessage(audience: Audience, programName: string): Message {
  return audience === "alumni"
    ? {
        subject: "Two minutes to help {program} students",
        intro:
          "Hi {first_name},\n\nYou studied {program} at North Sound State. Where did it take you? Your answers help current students choose with real data, and they update your alumni record.\n\nIt takes about {minutes} minutes.",
        sender: "Dean R. Okafor",
      }
    : {
        subject: "Which skills should {program} grads bring to your team?",
        intro:
          "Hi {first_name},\n\nYour team has hired graduates of {program} at North Sound State. Tell us which skills matter most, so we can teach them. It takes about {minutes} minutes.",
        sender: "Dean R. Okafor",
      };
}

export const MERGE_FIELDS = ["{first_name}", "{program}", "{minutes}"] as const;

export function fillMerge(text: string, v: { first_name: string; program: string; minutes: number }) {
  return text.replace(/\{first_name\}/g, v.first_name).replace(/\{program\}/g, v.program).replace(/\{minutes\}/g, String(v.minutes));
}

/* ------------------------------------------------- form ⇄ answer */

type Get = (name: string) => string;
type GetAll = (name: string) => string[];

/** Reads one question's answer from its form fields (the respondent page posts one Form per step). */
export function answerFromForm(q: Question, get: Get, getAll: GetAll): Answer | null {
  const t = (n: string) => get(n).trim().slice(0, 2000);
  switch (q.type) {
    case "single": {
      const choice = t("choice");
      if (!choice) return null;
      return choice === "other" ? { choice, other: t("other").slice(0, 300) } : { choice };
    }
    case "multi":
    case "skills": {
      const known = new Set([...(q.options.choices ?? []).map((c) => c.id), "other"]);
      const choices = [...new Set(getAll("choice"))].filter((c) => known.has(c));
      const other = choices.includes("other") || t("other") ? t("other").slice(0, 300) : "";
      const all = other && !choices.includes("other") ? [...choices, "other"] : choices;
      return all.length ? { choices: all, ...(other ? { other } : {}) } : null;
    }
    case "scale":
    case "nps": {
      const raw = get("value");
      const v = raw === "" ? NaN : Number(raw);
      return Number.isInteger(v) ? { value: v } : null;
    }
    case "yesno": {
      const v = get("value");
      return v === "yes" || v === "no" ? { value: v } : null;
    }
    case "short":
    case "long": {
      const text = t("text");
      return text ? { text } : null;
    }
    case "job": {
      const employed = get("employed");
      if (employed !== "yes" && employed !== "no") return null;
      if (employed === "no") return { employed };
      const unit = get("unit") === "hour" ? "hour" : "year";
      const related = get("related");
      const start = t("start");
      return {
        employed,
        title: t("title").slice(0, 120),
        employer: t("employer").slice(0, 120),
        start: /^\d{4}-\d{2}$/.test(start) ? start : "",
        salary: t("salary").replace(/[$,\s]/g, "").slice(0, 12),
        unit,
        ...(related === "yes" || related === "no" ? { related } : {}),
      };
    }
  }
}

/** A gentle message when an answer can't be accepted (or a required one is missing), else null. */
export function answerProblem(q: Question, a: Answer | null): string | null {
  if (q.type === "job" && a && (a as JobAnswer).employed === "yes") {
    const j = a as JobAnswer;
    if (!j.title?.trim()) return "Add your job title, or choose No.";
    if (j.salary && !/^\d+(\.\d+)?$/.test(j.salary)) return "Enter the salary as a number, like 62000.";
  }
  if ((q.type === "multi" || q.type === "skills") && a && q.options.max) {
    const n = (a as { choices: string[] }).choices.length;
    if (n > q.options.max) return `Pick up to ${q.options.max}.`;
  }
  if (q.type === "single" && a && (a as { choice: string }).choice === "other" && !(a as { other?: string }).other?.trim()) return "Tell us what “Other” is.";
  if (!q.required || isAnswered(q, a ?? undefined)) return null;
  switch (q.type) {
    case "single":
    case "yesno":
      return "Pick one to continue.";
    case "multi":
    case "skills":
      return "Pick at least one to continue.";
    case "scale":
    case "nps":
      return "Choose a number to continue.";
    case "job":
      return "Tell us whether you're working right now.";
    default:
      return "Type an answer to continue.";
  }
}
