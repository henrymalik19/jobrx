// When the apply runner updates itself: it checks GitHub's main now and then, and once it's idle it fast-forwards
// the folder and restarts on the new code. Only a plain fast-forward of main with nothing uncommitted: anything
// else is yours to sort out (it says why), and it never merges, stashes or resets.

/** What the runner knows about its folder and GitHub's main. */
export type UpdateState = {
  /** The commit it started with. */
  started: string;
  /** The folder's commit now. */
  head: string;
  /** The folder's branch. */
  branch: string;
  /** Uncommitted changes to tracked files. */
  dirty: boolean;
  /** Commits on GitHub's main the folder doesn't have (null: it couldn't ask GitHub). */
  behindRemote: number | null;
  /** Commits in the folder GitHub's main doesn't have. */
  ahead: number;
};

/**
 * What to do about updating, once nothing is open: nothing, restart (the folder's code already moved on, say
 * after your own pull), pull then restart, or nothing with a reason (newer code on GitHub it won't pull).
 */
export type UpdateStep =
  | { kind: "none" }
  | { kind: "restart" }
  | { kind: "pull" }
  | { kind: "blocked"; why: string };

/** The next update step for a runner in this state. */
export function nextUpdateStep(s: UpdateState): UpdateStep {
  if (s.behindRemote) {
    if (s.branch !== "main") return { kind: "blocked", why: `the folder is on ${s.branch === "HEAD" ? "no branch" : `branch ${s.branch}`}, not main` };
    if (s.ahead > 0) return { kind: "blocked", why: `the folder has ${s.ahead} commit(s) GitHub doesn't` };
    if (s.dirty) return { kind: "blocked", why: "the folder has uncommitted changes" };
    return { kind: "pull" };
  }
  if (s.started && s.head && s.head !== s.started) return { kind: "restart" };
  return { kind: "none" };
}

/** Whether a pull changed what `pnpm install` installs (so it runs before the restart). */
export const needsInstall = (changedFiles: string[]) => changedFiles.some((f) => f === "package.json" || f === "pnpm-lock.yaml");
