import type { Db } from "@/server/db/types";
import type { AppStatus } from "@/server/modules/applications/application-status";
import { listApplications, runnerHandedBack, type ApplicationWithDetails } from "@/server/modules/applications/applications.service";

/**
 * The two lanes waiting on you before approval, by the statuses each holds (ids match todoHref).
 * Ready to approve includes forms preparing found can't be filled automatically. `hint` is the one line
 * shown above the lane; `about` is the rest, behind its ⓘ.
 */
export const TABS = [
  {
    id: "ready",
    label: "Ready to approve",
    statuses: ["queued", "manual"],
    hint: "Check each one, then approve or skip.",
    about: "Every required question is answered, or the form can't be filled automatically (approve those to wait for the apply runner, or apply yourself). Open one to check it, then approve or skip.",
    empty: "Nothing to approve. New applications are prepared after each matching run.",
  },
  {
    id: "answers",
    label: "Missing answers",
    statuses: ["needs_input"],
    hint: "Questions only you can answer. Your answers fill in on other forms too.",
    about: "A required question couldn't be answered from your profile or saved answers. Open one to answer; once nothing is missing it moves to Ready to approve, and short answers fill in on other forms.",
    empty: "No questions waiting on you.",
  },
] as const satisfies readonly { id: string; label: string; statuses: readonly AppStatus[]; hint: string; about: string; empty: string }[];

/** A To do lane. */
export type TabId = (typeof TABS)[number]["id"];

/** Whether a value names a To do lane. */
export const isTabId = (v: unknown): v is TabId => TABS.some((t) => t.id === v);

/** Which lane an application is in, from its status. */
export function laneOf(status: string): TabId | null {
  return TABS.find((t) => (t.statuses as readonly string[]).includes(status))?.id ?? null;
}

/** Each lane's applications, in the order To do lists them (ones the apply runner handed back are on the board). */
export function splitLanes(listed: ApplicationWithDetails[]): Record<TabId, ApplicationWithDetails[]> {
  const apps = listed.filter((a) => !runnerHandedBack(a));
  return Object.fromEntries(TABS.map((t) => [t.id, apps.filter((a) => (t.statuses as readonly string[]).includes(a.status))])) as Record<TabId, ApplicationWithDetails[]>;
}

/** What places an application in a lane: To do lists best match first, then newest first. */
export type LaneItem = { id: string; score: number | null; created_at: string };

/** Negative when `a` is listed before `b` in a lane, positive when after. */
function order(a: LaneItem, b: LaneItem): number {
  return (b.score ?? 0) - (a.score ?? 0) || b.created_at.localeCompare(a.created_at);
}

/** One lane's applications, in To do's order, as it is now. */
export async function laneItems(db: Db, userId: string, tab: TabId): Promise<LaneItem[]> {
  const lane = TABS.find((t) => t.id === tab)!;
  return splitLanes(await listApplications(db, userId, [...lane.statuses]))[tab].map(({ id, score, created_at }) => ({ id, score, created_at }));
}

/** An application's page opened from a To do lane: the arrows step through that lane. */
export const laneHref = (id: string, tab: TabId) => `/app/applications/${id}?from=todo&tab=${tab}`;

/**
 * Where an application is in a lane: the ones before and after it (null at either end), and its place in it.
 * Once it has left the lane (its last answer moved it on), its place is null and its neighbours are the ones
 * around where it stood.
 */
export function lanePosition(items: LaneItem[], app: LaneItem): { prev: string | null; next: string | null; index: number | null; total: number } {
  const i = items.findIndex((x) => x.id === app.id);
  if (i >= 0) return { prev: items[i - 1]?.id ?? null, next: items[i + 1]?.id ?? null, index: i, total: items.length };
  const at = items.findIndex((x) => order(x, app) > 0);
  const after = at < 0 ? items.length : at;
  return { prev: items[after - 1]?.id ?? null, next: items[after]?.id ?? null, index: null, total: items.length };
}
