import type { Db } from "@/server/db/types";
import { check, unwrap } from "@/server/core/errors";

/**
 * Records that applications were notified in their current status. Only rows
 * still in that status are touched, so a change made meanwhile is notified next time.
 */
export async function markNotified(db: Db, items: { id: string; status: string }[]): Promise<void> {
  const byStatus = new Map<string, string[]>();
  for (const i of items) byStatus.set(i.status, [...(byStatus.get(i.status) ?? []), i.id]);
  for (const [status, ids] of byStatus) {
    check(await db.from("applications").update({ notified_status: status }).in("id", ids).eq("status", status), "mark notified");
  }
}

/** When a user's last digest went out, from `worker_runs` (worker `notify`, a run that sent one), or null. */
export async function lastSentAt(db: Db, userId: string): Promise<Date | null> {
  const rows = unwrap(
    await db
      .from("worker_runs")
      .select("started_at")
      .eq("worker", "notify")
      .eq("user_id", userId)
      .eq("ok", true)
      .gt("counts->sent", 0)
      .order("started_at", { ascending: false })
      .limit(1),
    "last notification",
  );
  return rows[0] ? new Date(rows[0].started_at) : null;
}
