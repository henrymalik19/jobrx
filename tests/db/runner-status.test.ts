// What the apply runner reports about itself (Settings shows it): saved per user, read back, and whether it's
// running by when it was last seen.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Db } from "@/server/db/types";
import { getRunnerStatus, reportRunnerStatus, runnerRunning, RUNNER_STATUS_KEY, type RunnerStatus } from "@/server/modules/apply/runner-status";
import type {} from "./setup";
import { testUser } from "./users";

const { url, serviceRoleKey } = inject("supabase");
const db = createClient(url, serviceRoleKey) as unknown as Db;
let userId = "";
let cleanup: () => Promise<void> = async () => {};

beforeAll(async () => {
  ({ id: userId, cleanup } = await testUser(db));
  await db.from("user_settings").delete().eq("user_id", userId).eq("key", RUNNER_STATUS_KEY);
});
afterAll(async () => {
  await db.from("user_settings").delete().eq("user_id", userId).eq("key", RUNNER_STATUS_KEY);
  await cleanup();
});

describe("runner status", () => {
  it("saves what the runner reports and tells whether it's running", async () => {
    expect(await getRunnerStatus(db, userId)).toBeNull();
    const now = new Date("2026-11-13T12:00:00Z");
    const status: RunnerStatus = {
      version: "85e93e3aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", message: "A closed posting expires", localChanges: false,
      startedAt: "2026-11-13T11:00:00Z", seenAt: "2026-11-13T11:59:00Z", behind: false, stoppedAt: null,
    };
    await reportRunnerStatus(db, userId, status);
    const saved = await getRunnerStatus(db, userId);
    expect(saved).toEqual(status);
    expect(runnerRunning(saved!, now)).toBe(true);
    // Not seen for a few minutes, or stopped: not running.
    expect(runnerRunning({ ...status, seenAt: "2026-11-13T11:50:00Z" }, now)).toBe(false);
    expect(runnerRunning({ ...status, stoppedAt: "2026-11-13T11:59:30Z" }, now)).toBe(false);
  });
});
