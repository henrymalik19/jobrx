// Phone alerts on Settings: the app installs (manifest, service worker), alerts turn on in this browser and
// it's listed, a test alert goes out through Chrome's real push service, and alerts turn off again.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { E2E_PORT, E2E_USER, localAdmin } from "./local";

const db = localAdmin();
test.afterEach(async () => void (await db.from("push_subscriptions").delete().eq("user_id", E2E_USER.id)));

test("serves the manifest and the service worker without signing in", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect(await manifest.json()).toMatchObject({ name: "Jobrx", display: "standalone", start_url: "/app" });
  const sw = await request.get("/sw.js");
  expect(sw.ok()).toBe(true);
  expect(await sw.text()).toContain("showNotification");
  expect((await request.get("/icon-192.png")).ok()).toBe(true);
});

test("turns phone alerts on in this browser, sends a test, and turns them off", async ({ headless }) => {
  // A new Chrome profile registering with its push service takes a while.
  test.setTimeout(120_000);
  // Chrome allows push only in a real profile (not the incognito-like contexts tests get), with its background
  // networking on (Playwright turns it off): a profile of its own, signed in as the test user.
  const dir = await mkdtemp(path.join(tmpdir(), "jobrx-push-"));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: "chrome",
    headless,
    ignoreDefaultArgs: ["--disable-background-networking"],
    baseURL: `http://localhost:${E2E_PORT}`,
  });
  try {
    await ctx.grantPermissions(["notifications"]);
    const state = JSON.parse(await readFile("tests/e2e/.auth/user.json", "utf8")) as { cookies: Parameters<typeof ctx.addCookies>[0] };
    await ctx.addCookies(state.cookies);
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto("/app/settings");
    const card = page.locator("[data-slot=card]").filter({ hasText: "Phone alerts" });
    await expect(card.getByText("Off", { exact: true })).toBeVisible();
    await card.getByRole("button", { name: "Turn on for this device" }).click();

    // A Chrome that can't reach its push service (no network, headless) says so on the card.
    const on = card.getByRole("button", { name: "Turn off on this device" });
    const refused = card.getByText(/Couldn't turn alerts on/);
    await expect(on.or(refused)).toBeVisible({ timeout: 30_000 });
    if (await refused.isVisible()) test.skip(true, `this Chrome couldn't subscribe: ${await refused.textContent()}`);

    await expect(card.getByText("On for 1")).toBeVisible();
    await expect(card.getByText(/Chrome on (Windows|Linux|Mac)/)).toBeVisible();
    // Sent through Chrome's push service with the app's keys, as a real alert is.
    await card.getByRole("button", { name: "Send a test" }).click();
    await expect(card.getByText("Sent to 1 device.")).toBeVisible({ timeout: 30_000 });

    await on.click();
    await expect(card.getByRole("button", { name: "Turn on for this device" })).toBeVisible();
    await expect(card.getByText("Off", { exact: true })).toBeVisible();
  } finally {
    await ctx.close();
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});
