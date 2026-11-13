// The Applying board: moving a card with its Move menu, and the arrows that scroll the lanes.
import { expect, test } from "@playwright/test";
import { localAdmin } from "./local";
import { seedCompany } from "./seed";

const db = localAdmin();
let seed: Awaited<ReturnType<typeof seedCompany>>;
test.beforeEach(async () => {
  seed = await seedCompany(db);
});
test.afterEach(async () => seed.cleanup());

test("moves a submitted application to Interviewing", async ({ page }) => {
  const app = await seed.application("move", "submitted", { submitted_at: new Date().toISOString() });
  await page.goto("/app/applying");

  const submitted = page.getByRole("region", { name: "Submitted" });
  await expect(submitted.getByText(app.title)).toBeVisible();
  await submitted.getByRole("button", { name: `Move ${app.title}` }).click();
  await page.getByRole("button", { name: "Interviewing" }).click();

  await expect(page.getByRole("region", { name: "Interviewing" }).getByText(app.title)).toBeVisible();
  await expect.poll(() => seed.status(app.id)).toBe("interviewing");
});

test("shows arrows while there are more lanes that way", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto("/app/applying");
  const later = page.getByRole("button", { name: "Scroll to later lanes" });
  const earlier = page.getByRole("button", { name: "Scroll to earlier lanes" });
  await expect(later).toBeVisible();
  await expect(earlier).toHaveCount(0);
  await later.click();
  await expect(earlier).toBeVisible();
});
