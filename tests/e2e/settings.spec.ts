// Settings opens, with the Versions card; the sidebar's version is for admins only (the test user is a member).
import { expect, test } from "@playwright/test";

test("opens Settings with the versions, and no sidebar version for a member", async ({ page }) => {
  await page.goto("/app/settings");
  await expect(page.getByText("Versions", { exact: true })).toBeVisible();
  await expect(page.getByText("Apply runner").first()).toBeVisible();
  await expect(page.locator("aside").getByRole("link", { name: /^v / })).toHaveCount(0);
});
