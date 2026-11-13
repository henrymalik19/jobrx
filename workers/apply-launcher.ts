// `pnpm worker:apply`: runs the apply runner, and runs it again when it exits to update itself (it pulled
// newer code, or the folder's code moved on, while nothing was open). Any other exit, Ctrl+C included, ends
// here too. This file is loaded once, so a change to it needs a manual restart.
import { spawn } from "node:child_process";
import { RESTART_EXIT } from "./apply-update";

const ARGS = ["--env-file-if-exists=.env.local", "--env-file-if-exists=.env.apply", "--import", "tsx", "workers/apply.ts"];
/** More restarts than this in 10 minutes means something is wrong: it stops instead of looping. */
const MAX_RESTARTS = 3;

const restarts: number[] = [];

function start() {
  const child = spawn(process.execPath, ARGS, { stdio: "inherit", env: { ...process.env, APPLY_SUPERVISED: "1" } });
  child.on("exit", (code, signal) => {
    if (code !== RESTART_EXIT) process.exit(code ?? (signal ? 1 : 0));
    const now = Date.now();
    restarts.push(now);
    if (restarts.filter((t) => t > now - 10 * 60_000).length > MAX_RESTARTS) {
      console.error(`${new Date().toISOString()} the apply runner restarted ${MAX_RESTARTS} times in 10 minutes; stopping (start it again with pnpm worker:apply)`);
      process.exit(1);
    }
    console.log(`${new Date().toISOString()} restarting the apply runner on the new code`);
    start();
  });
}

// Ctrl+C reaches the runner too, which stops by itself (handing back what's open); this only waits for it.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) process.on(signal, () => undefined);
start();
