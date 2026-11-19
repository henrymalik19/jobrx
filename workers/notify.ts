// Notify worker: for every user, first tracks the job inbox (replies move
// applications: confirmed, rejected, interviewing, heard back), then sends their
// daily digest once it is due (user setting `notifications`: the time and time zone;
// it goes to their job inbox, else the address they sign in with). Railway runs it
// every 15 minutes (notify service); the pipeline also chains it. Tracking needs
// JOB_INBOX_PASSWORD.
//   pnpm worker:notify   (reads .env.local locally; Railway variables in production)
import { createServiceClient } from "@/server/db/service-client";
import { parseWorkerEnv } from "@/shared/env";
import { notify, runStages, trackEmail } from "./stages";

async function main() {
  const db = createServiceClient(parseWorkerEnv(process.env));
  if (!(await runStages(db, [trackEmail, notify]))) process.exitCode = 1;
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
  process.exit(1);
});
