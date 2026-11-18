"use server";

import { ownerContext } from "@/server/auth/require-owner";
import { loadLiveForms, wantLiveView, type LiveForm } from "@/server/modules/apply/live-view";
import { getRunnerStatus, runnerRunning } from "@/server/modules/apply/runner-status";

/** What the live view shows: whether the runner is running, and the forms it has open. */
export type LiveView = { running: boolean; seenAt: string | null; forms: LiveForm[] };

/**
 * The runner's live view, asked for again while the page watches: it keeps the runner taking screenshots
 * for a little longer, and answers the forms open now with their latest ones.
 */
export async function liveViewAction(): Promise<LiveView> {
  const { db, owner } = await ownerContext();
  const now = new Date();
  const [status, forms] = await Promise.all([getRunnerStatus(db, owner.id), loadLiveForms(db, owner.id), wantLiveView(db, owner.id, now)]);
  return { running: status ? runnerRunning(status, now) : false, seenAt: status?.seenAt ?? null, forms };
}
