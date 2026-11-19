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

test("on a phone: one column at a time, picked from a list, its cards down the page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const sent: { title: string }[] = [];
  for (let i = 0; i < 8; i++) sent.push(await seed.application(`phone${i}`, "submitted", { submitted_at: new Date().toISOString() }));
  const stuck = await seed.application("phone-stuck", "manual", { apply_note: "Nobody submitted the form within 30 minutes." });
  await page.goto("/app/applying");

  const column = page.getByRole("combobox", { name: "Board column" });
  await expect(column).toBeVisible();
  // One column shows; the others wait in the list.
  const picked = await column.inputValue();
  await column.selectOption({ label: (await column.locator("option").allTextContents()).find((o) => o.startsWith("Submitted"))! });
  const submitted = page.getByRole("region", { name: "Submitted" });
  await expect(submitted.getByText(sent[7].title)).toBeVisible();
  await expect(page.getByRole("region", { name: "Runner stuck" })).toBeHidden();
  // Its cards go down the page: the column doesn't scroll on its own.
  const box = await submitted.evaluate((s) => ({ scroll: s.scrollHeight, shown: s.clientHeight }));
  expect(box.scroll).toBeLessThanOrEqual(box.shown + 1);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/applying-phone.png`, fullPage: true });

  await column.selectOption({ label: (await column.locator("option").allTextContents()).find((o) => o.startsWith("Runner stuck"))! });
  await expect(page.getByRole("region", { name: "Runner stuck" }).getByText(stuck.title)).toBeVisible();
  await expect(submitted).toBeHidden();
  expect(picked).toBeTruthy();
});
