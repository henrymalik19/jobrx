// What the apply runner on your computer reports about itself: the commit it runs, when it started, when it
// was last seen, and whether the code on disk changed since it started (it runs what it loaded then, so a
// pull or a push from that folder needs a restart). Shown on Settings next to the app's own version.
import { z } from "zod";
import type { Db } from "@/server/db/types";
import { getUserSetting, putUserSetting } from "@/server/modules/settings/settings.repository";

/** The user setting that holds it. */
export const RUNNER_STATUS_KEY = "apply_runner";
/** The runner reports every minute while running: one not seen for longer than this isn't running. */
export const RUNNER_OFFLINE_MS = 3 * 60_000;

/** What the runner reports. */
export const runnerStatusSchema = z.object({
  /** The commit it runs ("" when it couldn't tell). */
  version: z.string(),
  message: z.string(),
  /** Changes in the folder not committed when it started. */
  localChanges: z.boolean(),
  startedAt: z.string(),
  seenAt: z.string(),
  /** The folder's code moved on since it started: a restart runs the new code. */
  behind: z.boolean(),
  /** When it stopped (Ctrl+C); null while running. */
  stoppedAt: z.string().nullable(),
});
/** One report, as saved. */
export type RunnerStatus = z.infer<typeof runnerStatusSchema>;

/** Saves what the runner reports. */
export async function reportRunnerStatus(db: Db, userId: string, status: RunnerStatus): Promise<void> {
  await putUserSetting(db, userId, RUNNER_STATUS_KEY, status);
}

/** The runner's last report, or null when it never reported. */
export async function getRunnerStatus(db: Db, userId: string): Promise<RunnerStatus | null> {
  const parsed = runnerStatusSchema.safeParse(await getUserSetting(db, userId, RUNNER_STATUS_KEY));
  return parsed.success ? parsed.data : null;
}

/** Whether the runner is running now, by its last report. */
export const runnerRunning = (s: RunnerStatus, now: Date) => !s.stoppedAt && now.getTime() - new Date(s.seenAt).getTime() < RUNNER_OFFLINE_MS;
