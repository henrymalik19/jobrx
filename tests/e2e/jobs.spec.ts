// The Jobs page on a phone: the filters past the search box open from a button, and the pager fits one line.
import { expect, test } from "@playwright/test";

test("on a phone: the filters past the search box open from a button", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/jobs?site=ashby");
  const search = page.getByRole("textbox", { name: "Search title or company" });
  await expect(search).toBeVisible();
  const site = page.getByRole("combobox", { name: "Site" });
  await expect(site).toBeHidden();
  // One filter is set (the site): the button says so, and opens them.
  const button = page.getByRole("button", { name: "Filters (1 set)" });
  await button.click();
  await expect(site).toBeVisible();
  await expect(site).toHaveValue("ashby");
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/jobs-phone-filters.png` });
  await button.click();
  await expect(site).toBeHidden();
  const widest = await page.evaluate(() => Math.max(...[...document.querySelectorAll("main *")].map((e) => e.getBoundingClientRect().right)));
  expect(widest).toBeLessThanOrEqual(390);
});

test("on a phone: the pager is arrows and 1 / 2, on one line", async ({ page }) => {
  const { localAdmin } = await import("./local");
  const { seedCompany } = await import("./seed");
  const seed = await seedCompany(localAdmin());
  try {
    for (let i = 0; i < 51; i++) await seed.application(`page${i}`, "skipped");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/app/jobs?q=${seed.tag}&match=all&posted=any&state=all`);
    await expect(page.getByText("1 / 2")).toBeVisible();
    await expect(page.getByRole("link", { name: "Next" })).toBeVisible();
    const pager = page.getByText("1 / 2").locator("xpath=ancestor::div[2]");
    const box = (await pager.boundingBox())!;
    expect(box.height).toBeLessThan(60);
    const widest = await page.evaluate(() => Math.max(...[...document.querySelectorAll("main *")].map((e) => e.getBoundingClientRect().right)));
    expect(widest).toBeLessThanOrEqual(390);
    if (process.env.E2E_SHOTS) await pager.screenshot({ path: `${process.env.E2E_SHOTS}/jobs-phone-pager.png` });
  } finally {
    await seed.cleanup();
  }
});
