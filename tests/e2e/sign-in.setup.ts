// Signs in once (wrong password first) and saves the session for the other tests.
import { expect, test } from "@playwright/test";
import { E2E_USER } from "./local";

test("signs in, and refuses a wrong password", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E_USER.email);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByText("Sign-in failed.")).toBeVisible();

  // A failed attempt clears the form.
  await page.getByLabel("Email").fill(E2E_USER.email);
  await page.getByLabel("Password").fill(E2E_USER.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/app(\/|$)/);
  await expect(page.getByRole("button", { name: "Sign out" }).first()).toBeAttached();
  await page.context().storageState({ path: "tests/e2e/.auth/user.json" });
});
