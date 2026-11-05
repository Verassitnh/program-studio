import { data } from "react-router";
import {
  addDemoResponses,
  clearDemoResponses,
  closeSurvey,
  deleteDraft,
  duplicateSurvey,
  newVersion,
  remindSurvey,
  saveMessage,
  saveQuestions,
  scheduleSurvey,
  sendSurvey,
  setIncluded,
  unscheduleSurvey,
} from "~/lib/surveys.server";
import type { Route } from "./+types/api.surveys";

/**
 * POST /api/surveys/:surveyId { intent, … } → { intent, ok, message? | error?, id?, savedAt? }
 * Every survey write from the question editor, the recipients page, the Surveys slide-over and the survey
 * activity goes through here (fetchers). intents:
 *   save-questions {questions: JSON}   autosave; refused once any response exists
 *   save-message {subject, intro, sender}
 *   include {ids: JSON number[] | "all", included: "1" | "0"}
 *   send, schedule {date: YYYY-MM-DD}, unschedule, remind, close, duplicate, new-version, delete
 *   demo-add, demo-clear                SIMULATED demo responses (is_demo)
 */
export async function action({ request, params }: Route.ActionArgs) {
  const id = Number(params.surveyId);
  if (!Number.isInteger(id) || id <= 0) return data({ intent: "", ok: false, error: "Unknown survey." }, { status: 404 });
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const str = (k: string) => String(fd.get(k) ?? "");
  const json = (k: string) => {
    try {
      return JSON.parse(str(k));
    } catch {
      return undefined;
    }
  };
  let res: { ok: boolean; id?: number; message?: string; error?: string; savedAt?: string };
  switch (intent) {
    case "save-questions":
      res = await saveQuestions(id, json("questions"));
      break;
    case "save-message":
      res = await saveMessage(id, { subject: str("subject"), intro: str("intro"), sender: str("sender") });
      break;
    case "include": {
      const raw = str("ids") === "all" ? "all" : json("ids");
      const ids = raw === "all" ? "all" : Array.isArray(raw) ? raw.map(Number).filter(Number.isInteger) : [];
      res = await setIncluded(id, ids, str("included") === "1");
      break;
    }
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
    case "new-version":
      res = await newVersion(id);
      break;
    case "delete":
      res = await deleteDraft(id);
      break;
    case "demo-add":
      res = await addDemoResponses(id, 10);
      break;
    case "demo-clear":
      res = await clearDemoResponses(id);
      break;
    default:
      res = { ok: false, error: "Unknown action." };
  }
  return data({ intent, ...res }, { status: res.ok ? 200 : 400 });
}

export const loader = () => Response.json({ error: "POST to change a survey" }, { status: 405 });
