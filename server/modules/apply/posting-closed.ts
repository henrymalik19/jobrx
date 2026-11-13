// A LinkedIn posting the apply runner found no longer accepting applications. Discovery marks a job closed when
// it leaves its board, but nothing re-reads LinkedIn postings, so the runner reports it: the job is marked
// closed, leaving the open ones, and discovery's next run expires every other unsent application to it.
import type { Db } from "@/server/db/types";
import { unwrap, ValidationError } from "@/server/core/errors";

/**
 * Marks the job of one of your applications closed, once (a job already closed keeps its date).
 *
 * @param userDb - Your own client: the application must be yours.
 * @param serviceDb - The service-role client, which can write jobs.
 * @returns Whether the job was marked closed now.
 * @throws {@link ValidationError} when the application isn't yours, or its job isn't from LinkedIn.
 */
export async function markPostingClosed(userDb: Db, serviceDb: Db, userId: string, applicationId: string, now = new Date()): Promise<boolean> {
  const { data, error } = await userDb.from("applications").select("job_id, jobs!inner(source, closed_at)").eq("id", applicationId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`read application: ${error.message}`);
  const app = data as unknown as { job_id: string; jobs: { source: string; closed_at: string | null } } | null;
  if (!app) throw new ValidationError("No such application.");
  // Only LinkedIn's: other postings are re-read by discovery, which knows when they close.
  if (app.jobs.source !== "linkedin") throw new ValidationError("Only a LinkedIn posting is marked closed this way.");
  if (app.jobs.closed_at) return false;
  const rows = unwrap(
    await serviceDb.from("jobs").update({ closed_at: now.toISOString() }).eq("id", app.job_id).is("closed_at", null).select("id"),
    "mark job closed",
  );
  return rows.length > 0;
}
