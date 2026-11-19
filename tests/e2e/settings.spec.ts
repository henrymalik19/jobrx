// Settings opens, with the Versions card and the daily email; the sidebar version is for admins only (the test user is a member).
import { expect, test } from "@playwright/test";
import { E2E_USER, localAdmin } from "./local";

test("opens Settings with the versions, and no sidebar version for a member", async ({ page }) => {
  await page.goto("/app/settings");
  await expect(page.getByText("Versions", { exact: true })).toBeVisible();
  await expect(page.getByText("Apply runner").first()).toBeVisible();
  await expect(page.locator("aside").getByRole("link", { name: /^v / })).toHaveCount(0);
});

test("sets the daily email's time, sent to the address the member signs in with", async ({ page }) => {
  const db = localAdmin();
  try {
    await page.goto("/app/settings");
    await expect(page.getByText(`One email a day to ${E2E_USER.email}`)).toBeVisible();
    await page.getByLabel("At", { exact: true }).selectOption("07:30");
    await page.getByLabel("Time zone", { exact: true }).selectOption("America/Chicago");
    await page.getByRole("button", { name: "Save" }).first().click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    await expect(page.locator("[data-slot=badge]", { hasText: "7:30 AM" })).toBeVisible();

    const { data } = await db.from("user_settings").select("value").eq("user_id", E2E_USER.id).eq("key", "notifications").single();
    expect(data!.value).toEqual({ digest: "daily", digest_time: "07:30", timezone: "America/Chicago" });
  } finally {
    await db.from("user_settings").delete().eq("user_id", E2E_USER.id).eq("key", "notifications");
  }
});
