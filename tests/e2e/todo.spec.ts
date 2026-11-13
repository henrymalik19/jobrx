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
