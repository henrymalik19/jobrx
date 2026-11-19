// To do: approving and skipping right from a row.
import { expect, test } from "@playwright/test";
import { localAdmin } from "./local";
import { seedCompany } from "./seed";

const db = localAdmin();
let seed: Awaited<ReturnType<typeof seedCompany>>;
test.beforeEach(async () => {
  seed = await seedCompany(db);
});
test.afterEach(async () => seed.cleanup());

test("approves and skips from the Ready to approve list", async ({ page }) => {
  const keep = await seed.application("approve", "queued");
  const drop = await seed.application("skip", "queued");
  await page.goto("/app/todo?tab=ready");

  const keepRow = page.getByRole("row").filter({ hasText: keep.title });
  await keepRow.getByRole("button", { name: "Approve" }).click();
  await expect(keepRow).toHaveCount(0);
  await expect.poll(() => seed.status(keep.id)).toBe("approved");

  const dropRow = page.getByRole("row").filter({ hasText: drop.title });
  await dropRow.getByRole("button", { name: "Skip" }).click();
  // Skip asks once more.
  await dropRow.getByRole("button", { name: "Skip it" }).click();
  await expect(dropRow).toHaveCount(0);
  await expect.poll(() => seed.status(drop.id)).toBe("skipped");
});

test("steps through a lane from an application, and approving goes on to the next", async ({ page }) => {
  // Newest first, as To do lists them: third, second, first.
  const first = await seed.application("first", "queued");
  const second = await seed.application("second", "queued");
  const third = await seed.application("third", "queued");
  await page.goto("/app/todo?tab=ready");
  await page.getByRole("row").filter({ hasText: second.title }).getByRole("link", { name: second.title }).click();
  const title = page.getByRole("heading", { level: 1 });
  await expect(title).toHaveText(second.title);

  const nav = page.getByRole("navigation", { name: "Step through Ready to approve" });
  await nav.getByRole("link", { name: "Next" }).click();
  await expect(title).toHaveText(first.title);
  // The keyboard steps too.
  await page.keyboard.press("ArrowLeft");
  await expect(title).toHaveText(second.title);
  await page.keyboard.press("ArrowLeft");
  await expect(title).toHaveText(third.title);

  // Approving goes on to the next one in the lane, as it is now.
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(title).toHaveText(second.title);
  await expect.poll(() => seed.status(third.id)).toBe("approved");
  await expect(page).toHaveURL(/from=todo&tab=ready/);

  // Esc goes back to the list.
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/app\/todo\?tab=ready$/);
});
