// The runner's live view: while you watch the Applying page, the runner keeps a screenshot of each form it has
// open, so you can see what it's doing from your phone without remote desktop.
//
// The page asks for it (a `runner_live_view` setting with a time it's wanted until, renewed as you watch); the
// runner checks every few seconds and, while it's wanted, writes each open form's screenshot over the last one
// in apply-runs/<you>/live/<application>.jpg. A closed form's screenshot is removed. Nobody watching, nothing
// is taken or uploaded.
import type { Db } from "@/server/db/types";
import { unwrap } from "@/server/core/errors";
import { getUserSetting, putUserSetting } from "@/server/modules/settings/settings.repository";
import { APPLY_RUNS_BUCKET } from "./apply-runs";
import type { ApplyStep } from "./apply.repository";

/** The user setting that says until when the live view is wanted. */
export const LIVE_VIEW_KEY = "runner_live_view";
/** How long one ask lasts: the page renews it while it's open, so a closed page stops it soon after. */
export const LIVE_VIEW_MS = 45_000;
/** How often the runner takes a new screenshot while you watch. */
export const LIVE_SHOT_MS = 5_000;

/** Where an open form's screenshot is kept. */
export const liveShotPath = (userId: string, applicationId: string) => `${userId}/live/${applicationId}.jpg`;

/** Asks the runner for live screenshots for the next {@link LIVE_VIEW_MS}. */
export async function wantLiveView(db: Db, userId: string, now: Date): Promise<void> {
  await putUserSetting(db, userId, LIVE_VIEW_KEY, { until: new Date(now.getTime() + LIVE_VIEW_MS).toISOString() });
}

/** Whether someone is watching now (the runner asks this before each round of screenshots). */
export async function liveViewWanted(db: Db, userId: string, now: Date): Promise<boolean> {
  const v = (await getUserSetting(db, userId, LIVE_VIEW_KEY)) as { until?: unknown } | null;
  return typeof v?.until === "string" && new Date(v.until).getTime() > now.getTime();
}

/** Writes an open form's screenshot over its last one. */
export async function uploadLiveShot(db: Db, userId: string, applicationId: string, jpeg: Uint8Array): Promise<void> {
  const { error } = await db.storage.from(APPLY_RUNS_BUCKET).upload(liveShotPath(userId, applicationId), jpeg, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(`upload live screenshot: ${error.message}`);
}

/** Removes a closed form's screenshot (never throws: a leftover one is only shown as old). */
export async function removeLiveShot(db: Db, userId: string, applicationId: string): Promise<void> {
  await db.storage.from(APPLY_RUNS_BUCKET).remove([liveShotPath(userId, applicationId)]).catch(() => undefined);
}

/** One form the runner has open, as the live view shows it. */
export type LiveForm = {
  applicationId: string;
  title: string;
  company: string;
  step: ApplyStep;
  note: string | null;
  /** A link to its latest screenshot (good for a few minutes), or null before the first one. */
  shotUrl: string | null;
  /** When that screenshot was taken. */
  shotAt: string | null;
};

/** The forms the runner has open (an application with a step set), each with its latest screenshot. */
export async function loadLiveForms(db: Db, userId: string): Promise<LiveForm[]> {
  const rows = unwrap(
    await db
      .from("applications")
      .select("id, apply_step, apply_note, jobs!inner(title, company_name)")
      .eq("user_id", userId)
      .eq("status", "approved")
      .not("apply_step", "is", null),
    "list open forms",
  ) as unknown as { id: string; apply_step: ApplyStep; apply_note: string | null; jobs: { title: string; company_name: string } }[];
  if (rows.length === 0) return [];
  const bucket = db.storage.from(APPLY_RUNS_BUCKET);
  const { data: files } = await bucket.list(`${userId}/live`, { limit: 100 });
  const takenAt = new Map((files ?? []).map((f) => [f.name.replace(/\.jpg$/, ""), f.updated_at ?? f.created_at ?? null]));
  const withShots = rows.filter((r) => takenAt.has(r.id));
  const { data: signed } = withShots.length
    ? await bucket.createSignedUrls(withShots.map((r) => liveShotPath(userId, r.id)), 300)
    : { data: [] as { signedUrl: string; path: string | null }[] };
  const urls = new Map((signed ?? []).map((s) => [s.path ?? "", s.signedUrl]));
  return rows.map((r) => {
    const at = takenAt.get(r.id) ?? null;
    // The time in the link changes with each new screenshot, so the browser doesn't show a cached one.
    const url = urls.get(liveShotPath(userId, r.id));
    return {
      applicationId: r.id, title: r.jobs.title, company: r.jobs.company_name, step: r.apply_step, note: r.apply_note,
      shotUrl: url ? `${url}&t=${encodeURIComponent(at ?? "")}` : null, shotAt: at,
    };
  });
}
