// Controlling the apply runner from the app (your phone, say): pause and resume it, pause LinkedIn only, restart it,
// and submit or hand back a form it has open and waiting for you.
//
// The app writes what you asked for to one setting (`apply_runner_control`); only the app writes it. The runner
// reads it every few seconds: pausing is a state it follows, and a restart or a form's action is a request with a
// time, done once (a restart asked for after it started; a form's action newer than the last it did for that form).
import { z } from "zod";
import { ValidationError } from "@/server/core/errors";
import type { Db } from "@/server/db/types";
import { getApplication } from "@/server/modules/applications/applications.repository";
import { getUserSetting, putUserSetting } from "@/server/modules/settings/settings.repository";

/** The user setting that holds it. */
export const RUNNER_CONTROL_KEY = "apply_runner_control";
/** How often the runner reads it. */
export const CONTROL_POLL_MS = 3_000;

/** What you can ask of a form the runner has open. */
export const FORM_ACTIONS = ["submit", "hand_back"] as const;
/** One of {@link FORM_ACTIONS}. */
export type FormAction = (typeof FORM_ACTIONS)[number];

/** What the app has asked of the runner. */
export const runnerControlSchema = z.object({
  /** Starts no new applications; what's open stays open. */
  paused: z.boolean().default(false),
  /** Starts no new LinkedIn applications and doesn't search LinkedIn. */
  linkedin_paused: z.boolean().default(false),
  /** A restart asked for at this time: a runner started before it restarts once what's open is done. */
  restart_at: z.string().nullable().default(null),
  /** The last action asked for each open form, by application id. */
  forms: z.record(z.string(), z.object({ action: z.enum(FORM_ACTIONS), at: z.string() })).default({}),
});
/** What the app has asked, as saved. */
export type RunnerControl = z.infer<typeof runnerControlSchema>;

/** What's asked now (nothing, when nothing was ever asked). */
export async function getRunnerControl(db: Db, userId: string): Promise<RunnerControl> {
  const parsed = runnerControlSchema.safeParse((await getUserSetting(db, userId, RUNNER_CONTROL_KEY)) ?? {});
  return parsed.success ? parsed.data : runnerControlSchema.parse({});
}

async function save(db: Db, userId: string, change: (c: RunnerControl) => RunnerControl): Promise<RunnerControl> {
  const next = change(await getRunnerControl(db, userId));
  await putUserSetting(db, userId, RUNNER_CONTROL_KEY, next);
  return next;
}

/** Pauses the runner (no new applications) or lets it go on. */
export function setRunnerPaused(db: Db, userId: string, paused: boolean): Promise<RunnerControl> {
  return save(db, userId, (c) => ({ ...c, paused }));
}

/** Pauses LinkedIn work only, or lets it go on. */
export function setLinkedInPaused(db: Db, userId: string, paused: boolean): Promise<RunnerControl> {
  return save(db, userId, (c) => ({ ...c, linkedin_paused: paused }));
}

/** Asks the runner to restart (on the latest code) once what's open is done. */
export function requestRestart(db: Db, userId: string, now: Date): Promise<RunnerControl> {
  return save(db, userId, (c) => ({ ...c, restart_at: now.toISOString() }));
}

/**
 * Asks the runner to submit, or hand back, a form it has filled and left waiting for you. Forms no longer open
 * are dropped from the setting as it's written.
 */
export async function requestFormAction(db: Db, userId: string, applicationId: string, action: FormAction, now: Date): Promise<RunnerControl> {
  const app = await getApplication(db, userId, applicationId);
  if (!app || app.status !== "approved" || !app.apply_step) throw new ValidationError("The runner doesn't have that form open any more.");
  if (app.apply_step !== "waiting_for_you") throw new ValidationError("It isn't waiting for you: the runner is still working on it.");
  const { data } = await db.from("applications").select("id").eq("user_id", userId).eq("status", "approved").not("apply_step", "is", null);
  const open = new Set((data ?? []).map((r) => r.id));
  return save(db, userId, (c) => ({
    ...c,
    forms: {
      ...Object.fromEntries(Object.entries(c.forms).filter(([id]) => open.has(id))),
      [applicationId]: { action, at: now.toISOString() },
    },
  }));
}

/**
 * The runner's side: what's newly asked of each form since it last looked (by `done`, the time of the last action
 * it took per form, which it keeps). Only forms in `open` count.
 */
export function newFormActions(control: RunnerControl, open: Iterable<string>, done: Map<string, string>): Map<string, FormAction> {
  const out = new Map<string, FormAction>();
  for (const id of open) {
    const asked = control.forms[id];
    if (asked && asked.at !== done.get(id)) out.set(id, asked.action);
  }
  return out;
}

/** Whether a restart was asked for after the runner started. */
export const restartAsked = (control: RunnerControl, startedAt: string) => !!control.restart_at && control.restart_at > startedAt;
