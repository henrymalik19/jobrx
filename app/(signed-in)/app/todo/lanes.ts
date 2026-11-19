import type { Db } from "@/server/db/types";
import type { AppStatus } from "@/server/modules/applications/application-status";
import { listApplications, runnerHandedBack, type ApplicationWithDetails } from "@/server/modules/applications/applications.service";

/**
 * The two lanes waiting on you before approval, by the statuses each holds (ids match todoHref).
 * Ready to approve includes forms preparing found can't be filled automatically.
 */
export const TABS = [
  {
    id: "ready",
    label: "Ready to approve",
    statuses: ["queued", "manual"],
    hint: "Every required question is answered, or the form can't be filled automatically (approve those to wait for the apply runner, or apply yourself). Open one to check it, then approve or skip.",
    empty: "Nothing to approve. New applications are prepared after each matching run.",
  },
  {
    id: "answers",
    label: "Missing answers",
    statuses: ["needs_input"],
    hint: "A required question couldn't be answered from your profile or saved answers. Open one to answer; once nothing is missing it moves to Ready to approve, and short answers fill in on other forms.",
    empty: "No questions waiting on you.",
  },
] as const satisfies readonly { id: string; label: string; statuses: readonly AppStatus[]; hint: string; empty: string }[];

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

/** One lane's application ids, in To do's order, as it is now. */
export async function laneIds(db: Db, userId: string, tab: TabId): Promise<string[]> {
  const lane = TABS.find((t) => t.id === tab)!;
  return splitLanes(await listApplications(db, userId, [...lane.statuses]))[tab].map((a) => a.id);
}

/** An application's page opened from a To do lane: the arrows step through that lane. */
export const laneHref = (id: string, tab: TabId) => `/app/applications/${id}?from=todo&tab=${tab}`;

/** Where you are in a lane: the ones before and after (null at either end), and your place in it (null once it has left the lane). */
export function lanePosition(ids: string[], id: string): { prev: string | null; next: string | null; index: number | null; total: number } {
  const i = ids.indexOf(id);
  if (i < 0) return { prev: null, next: ids[0] ?? null, index: null, total: ids.length };
  return { prev: ids[i - 1] ?? null, next: ids[i + 1] ?? null, index: i, total: ids.length };
}
