// The runner's live view on Applying: a form it has open shows with its step and latest screenshot, and
// watching the page asks the runner for screenshots.
import { expect, test } from "@playwright/test";
import { liveShotPath } from "@/server/modules/apply/live-view";
import { E2E_USER, localAdmin } from "./local";
import { seedCompany } from "./seed";

const db = localAdmin();
let seed: Awaited<ReturnType<typeof seedCompany>>;
let shot = "";
test.beforeEach(async () => {
  seed = await seedCompany(db);
});
test.afterEach(async () => {
  if (shot) await db.storage.from("apply-runs").remove([shot]);
  await db.from("user_settings").delete().eq("user_id", E2E_USER.id).in("key", ["runner_live_view", "apply_runner"]);
  await seed.cleanup();
});

test("shows what the runner has open in Chrome, with its screenshot", async ({ page }) => {
  const app = await seed.application("live", "approved", { apply_step: "waiting_for_you", apply_note: "Filled; click Submit in Chrome." });
  // A running runner, and the screenshot it took of the form (a tiny gray JPEG).
  const now = new Date().toISOString();
  await db.from("user_settings").upsert({ user_id: E2E_USER.id, key: "apply_runner", value: { version: "", message: "", localChanges: false, startedAt: now, seenAt: now, behind: false, stoppedAt: null } });
  shot = liveShotPath(E2E_USER.id, app.id);
  const jpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
    "base64",
  );
  const { error } = await db.storage.from("apply-runs").upload(shot, jpeg, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;

  await page.goto("/app/applying");
  const live = page.getByRole("region", { name: "Open in Chrome now" });
  await expect(live.getByRole("link", { name: app.title })).toBeVisible();
  await expect(live.getByText("Your turn in Chrome")).toBeVisible();
  await expect(live.getByText("Filled; click Submit in Chrome.")).toBeVisible();
  await expect(live.getByRole("img", { name: new RegExp(`The form for ${app.title}`) })).toBeVisible();

  // Watching the page asked the runner for screenshots.
  const { data } = await db.from("user_settings").select("value").eq("user_id", E2E_USER.id).eq("key", "runner_live_view").single();
  expect(new Date((data!.value as { until: string }).until).getTime()).toBeGreaterThan(Date.now());

  // Tapping the screenshot shows it bigger.
  await live.getByRole("button", { name: new RegExp(`Bigger screenshot of ${app.title}`) }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await live.getByRole("button", { name: new RegExp(`Bigger screenshot of ${app.title}`) }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
