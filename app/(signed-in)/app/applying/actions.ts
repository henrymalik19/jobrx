"use server";

import { ownerContext } from "@/server/auth/require-owner";
import { ValidationError } from "@/server/core/errors";
import { loadLiveForms, wantLiveView, type LiveForm } from "@/server/modules/apply/live-view";
import {
  FORM_ACTIONS,
  getLeftFields,
  getRunnerControl,
  requestFill,
  requestFormAction,
  requestRestart,
  restartAsked,
  setLinkedInPaused,
  setRunnerPaused,
  type FormAction,
  type LeftField,
} from "@/server/modules/apply/runner-control";
import { getRunnerStatus, runnerRunning } from "@/server/modules/apply/runner-status";

/** What the live view shows: the runner (running, paused, restarting), what you asked of it, and the forms it has open. */
export type LiveView = {
  running: boolean;
  seenAt: string | null;
  /** Paused from the app, as asked, and whether the runner has gone along with it yet. */
  paused: boolean;
  pausedSeen: boolean;
  linkedinPaused: boolean;
  /** A restart was asked for and the runner hasn't restarted since. */
  restarting: boolean;
  /** It can restart itself (started with pnpm worker:apply). */
  canRestart: boolean;
  /** The last action asked of each form, by application id, with when. */
  asked: Record<string, { action: FormAction; at: string }>;
  /** Each waiting form's empty boxes, as the runner last said, and your last answers sent for them. */
  left: Record<string, { fields: LeftField[]; at: string }>;
  given: Record<string, { at: string }>;
  forms: LiveForm[];
};

async function view(): Promise<LiveView> {
  const { db, owner } = await ownerContext();
  const now = new Date();
  const [status, forms, control, left] = await Promise.all([
    getRunnerStatus(db, owner.id),
    loadLiveForms(db, owner.id),
    getRunnerControl(db, owner.id),
    getLeftFields(db, owner.id),
    wantLiveView(db, owner.id, now),
  ]);
  const running = status ? runnerRunning(status, now) : false;
  return {
    running,
    seenAt: status?.seenAt ?? null,
    paused: control.paused,
    pausedSeen: !!status && status.paused === control.paused,
    linkedinPaused: control.linkedin_paused,
    restarting: running && !!status && restartAsked(control, status.startedAt),
    canRestart: !!status?.autoUpdate,
    asked: control.forms,
    left,
    given: Object.fromEntries(Object.entries(control.fills).map(([id, f]) => [id, { at: f.at }])),
    forms,
  };
}

/**
 * The runner's live view, asked for again while the page watches: it keeps the runner taking screenshots
 * for a little longer, and answers the forms open now with their latest ones.
 */
export async function liveViewAction(): Promise<LiveView> {
  return view();
}

/** What a control button answers: the view after it, or why it couldn't. */
export type ControlResult = { view?: LiveView; error?: string };

async function control(change: () => Promise<unknown>): Promise<ControlResult> {
  try {
    await change();
  } catch (err) {
    if (err instanceof ValidationError) return { error: err.message };
    throw err;
  }
  return { view: await view() };
}

/** Pauses the runner (no new applications start) or lets it go on. */
export async function pauseRunnerAction(paused: boolean): Promise<ControlResult> {
  const { db, owner } = await ownerContext();
  return control(() => setRunnerPaused(db, owner.id, paused === true));
}

/** Pauses LinkedIn work only, or lets it go on. */
export async function pauseLinkedInAction(paused: boolean): Promise<ControlResult> {
  const { db, owner } = await ownerContext();
  return control(() => setLinkedInPaused(db, owner.id, paused === true));
}

/** Restarts the runner on the latest code, once what's open is done. */
export async function restartRunnerAction(): Promise<ControlResult> {
  const { db, owner } = await ownerContext();
  return control(() => requestRestart(db, owner.id, new Date()));
}

/** Submits, or hands back, a form the runner filled and left waiting for you. */
export async function formAction(applicationId: string, action: FormAction): Promise<ControlResult> {
  const { db, owner } = await ownerContext();
  if (!FORM_ACTIONS.includes(action)) return { error: "Unknown action." };
  return control(() => requestFormAction(db, owner.id, String(applicationId), action, new Date()));
}

/** Your answers for a waiting form's empty boxes (by field key), for the runner to type in. */
export async function fillFieldsAction(applicationId: string, values: Record<string, string[]>): Promise<ControlResult> {
  const { db, owner } = await ownerContext();
  const clean = Object.fromEntries(
    Object.entries(values ?? {}).filter(([k, v]) => typeof k === "string" && Array.isArray(v)).map(([k, v]) => [k, v.map(String)]),
  );
  return control(() => requestFill(db, owner.id, String(applicationId), clean, new Date()));
}
