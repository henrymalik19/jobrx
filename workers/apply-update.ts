// The git side of the apply runner's self-update (server/modules/apply/self-update.ts decides): asks GitHub
// for main, reads the folder's state, fast-forwards and installs. Every command runs without a shell and
// without blocking the runner while it waits.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { needsInstall, nextUpdateStep, type UpdateStep } from "@/server/modules/apply/self-update";

const run = promisify(execFile);

/** The exit code that tells the launcher (apply-launcher.ts) to start the runner again on the new code. */
export const RESTART_EXIT = 75;

async function git(args: string[], timeout = 30_000): Promise<string> {
  const { stdout } = await run("git", args, { timeout, windowsHide: true });
  return stdout.trim();
}

/** Asks GitHub for main and says what to do (see nextUpdateStep); GitHub unreachable counts as nothing new. */
export async function checkForUpdate(started: string): Promise<UpdateStep & { head: string; remote: string | null }> {
  const fetched = await git(["fetch", "--quiet", "origin", "main"]).then(() => true, () => false);
  const [head, branch, dirty] = await Promise.all([
    git(["rev-parse", "HEAD"]),
    git(["rev-parse", "--abbrev-ref", "HEAD"]),
    git(["status", "--porcelain", "--untracked-files=no"]).then((s) => s !== ""),
  ]);
  let remote: string | null = null;
  let behindRemote: number | null = null;
  let ahead = 0;
  if (fetched) {
    remote = await git(["rev-parse", "origin/main"]);
    const [mine, theirs] = (await git(["rev-list", "--left-right", "--count", "HEAD...origin/main"])).split(/\s+/).map(Number);
    ahead = mine || 0;
    behindRemote = theirs || 0;
  }
  return { ...nextUpdateStep({ started, head, branch, dirty, behindRemote, ahead }), head, remote };
}

/**
 * Fast-forwards the folder to GitHub's main, installing dependencies when they changed. Returns what
 * went wrong, or null when the new code is in place.
 */
export async function pullUpdate(log: (line: string) => void): Promise<string | null> {
  const before = await git(["rev-parse", "HEAD"]);
  try {
    await git(["merge", "--ff-only", "--quiet", "origin/main"], 60_000);
  } catch (err) {
    return `git couldn't fast-forward: ${(err as Error).message.split("\n")[0]}`;
  }
  const changed = (await git(["diff", "--name-only", before, "HEAD"])).split("\n").filter(Boolean);
  if (needsInstall(changed)) {
    log("update: dependencies changed; installing");
    try {
      // pnpm is a script on Windows, so it runs through the shell there; the arguments are fixed.
      await run("pnpm", ["install", "--frozen-lockfile"], { timeout: 5 * 60_000, windowsHide: true, shell: process.platform === "win32" });
    } catch (err) {
      return `pnpm install failed: ${(err as Error).message.split("\n")[0]}`;
    }
  }
  return null;
}
