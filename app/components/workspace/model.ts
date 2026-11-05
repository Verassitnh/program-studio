/*
 * Client-safe definitions shared by the workspace pages (/surveys, /integrations, /exports, /account)
 * and app/lib/workspace.server.ts. No database access here.
 */

export type Audience = "employers" | "alumni";
export type SurveyStatus = "draft" | "scheduled" | "sent" | "closed";

/** What a question helps fill. `gap` questions are tied to a real count in the program's records. */
export type Question = { text: string; tag: string; gap?: "unknown_jobs" | "missing_wages" };

export type Template = { id: string; audience: Audience; name: string; minutes: number; questions: Question[] };

/** Questions mirror the in-activity survey stage (app/routes/review.survey.tsx). */
export const TEMPLATES: Template[] = [
  {
    id: "alumni-outcomes",
    audience: "alumni",
    name: "Alumni outcomes check-in",
    minutes: 2,
    questions: [
      { text: "Confirm your current job title and employer", tag: "unknown jobs", gap: "unknown_jobs" },
      { text: "Which courses do you actually use at work?", tag: "course value" },
      { text: "What got you hired?", tag: "why hired" },
      { text: "Salary range (optional)", tag: "missing wages", gap: "missing_wages" },
    ],
  },
  {
    id: "alumni-job-update",
    audience: "alumni",
    name: "Alumni job update (short)",
    minutes: 1,
    questions: [
      { text: "Confirm your current job title and employer", tag: "unknown jobs", gap: "unknown_jobs" },
      { text: "Salary range (optional)", tag: "missing wages", gap: "missing_wages" },
    ],
  },
  {
    id: "employer-skills",
    audience: "employers",
    name: "Employer skills and hiring",
    minutes: 3,
    questions: [
      { text: "Which 3 skills mattered most in their first year?", tag: "value" },
      { text: "What did they learn on the job that school should teach?", tag: "gaps" },
      { text: "Would you hire another grad this year?", tag: "demand" },
      { text: "Would you host an intern next year?", tag: "intern leads" },
      { text: "Which tools should new hires already know?", tag: "tools" },
    ],
  },
  {
    id: "employer-pulse",
    audience: "employers",
    name: "Employer hiring pulse (short)",
    minutes: 1,
    questions: [
      { text: "Would you hire another grad this year?", tag: "demand" },
      { text: "Would you host an intern next year?", tag: "intern leads" },
    ],
  },
];

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id);
export const templatesFor = (a: Audience) => TEMPLATES.filter((t) => t.audience === a);
export const DEFAULT_TEMPLATE: Record<Audience, string> = { alumni: "alumni-outcomes", employers: "employer-skills" };

export const AUDIENCE_LABEL: Record<Audience, string> = { employers: "Employers", alumni: "Alumni" };
export const STATUS_LABEL: Record<SurveyStatus, string> = { draft: "Draft", scheduled: "Scheduled", sent: "Sent", closed: "Closed" };

/** Simulated response model: one demo day passes per real minute after sending. */
export const DEMO_CLOCK = "Demo clock: 1 day per minute after sending";

/* ------------------------------------------------------------ connectors */

export type Connector = {
  key: string;
  letter: string;
  name: string;
  category: string;
  supplies: string[];
  screens: string[];
};

/** Other systems a school could connect. None of them is wired up in this prototype. */
export const CONNECTORS: Connector[] = [
  {
    key: "banner",
    letter: "B",
    name: "Ellucian Banner (SIS)",
    category: "Student records",
    supplies: ["Enrollment and completions by program and term", "Graduation dates and degree conferrals", "Student contact details at graduation"],
    screens: ["Programs dashboard (enrollment trend)", "Program review · Connect", "Surveys (alumni contact list)"],
  },
  {
    key: "workday",
    letter: "W",
    name: "Workday Student",
    category: "Student records",
    supplies: ["Program catalog and requirements", "Completions by term", "Advising notes on declared majors"],
    screens: ["Programs dashboard", "Program review · Build changes"],
  },
  {
    key: "slate",
    letter: "S",
    name: "Slate CRM",
    category: "Admissions",
    supplies: ["Applicant and admit counts by program", "Inquiry sources", "Yield by program"],
    screens: ["Programs dashboard (demand signal)", "Program review · Diagnose"],
  },
  {
    key: "canvas",
    letter: "C",
    name: "Canvas LMS",
    category: "Learning",
    supplies: ["Course outcomes and syllabi", "Assignment-level skill evidence"],
    screens: ["Program review · Explore (skill coverage)", "Program review · Build changes"],
  },
  {
    key: "handshake",
    letter: "H",
    name: "Handshake",
    category: "Career services",
    supplies: ["Employer contacts and recruiters", "Internship and job postings aimed at your students", "First-destination survey answers"],
    screens: ["Surveys (employer contact list)", "Program review · Build changes (internships)", "Outcomes story"],
  },
  {
    key: "lightcast-postings",
    letter: "L",
    name: "Lightcast Job Postings API",
    category: "Labor market",
    supplies: ["Live job-posting counts by occupation and county", "Skills named in postings", "Advertised wages"],
    screens: ["Program review · Explore", "Exports (alignment and skill coverage)"],
  },
];

/* --------------------------------------------------------------- format */

const TZ = "America/Los_Angeles";
const dtf = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ });
const df = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: TZ });
const nf = new Intl.NumberFormat("en-US");

/** Fixed time zone (the institution's), so server and client render the same string. */
export const fmtDateTime = (v: string | Date | null | undefined) => (v ? dtf.format(new Date(v)) : "—");
export const fmtDate = (v: string | Date | null | undefined) => (v ? df.format(new Date(v)) : "—");
export const fmtNum = (v: number | null | undefined) => (v == null ? "—" : nf.format(v));
export const pctOf = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);

/** "1 survey", "3 surveys". English-only prototype; Intl.PluralRules picks the form. */
const pr = new Intl.PluralRules("en-US");
export const plural = (n: number, one: string, other: string) => `${nf.format(n)} ${pr.select(n) === "one" ? one : other}`;

/** Shorter program names in dense tables: "BA — Operations, B.S." */
export const shortProgram = (name: string) => name.replace(/^Business Administration — /, "BA — ");
