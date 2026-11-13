// Headless Chrome for the browser driver tests. On a laptop without Chrome they skip; in CI (GitHub's
// Ubuntu image has Chrome) a missing Chrome fails the run, so the drivers never go untested by surprise.
import { chromium, type Browser } from "playwright-core";

/** Launches headless Chrome, or null when it isn't installed here (an error in CI). */
export async function testChrome(): Promise<Browser | null> {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch (e) {
    if (process.env.CI) throw new Error(`The browser driver tests need Chrome in CI: ${(e as Error).message}`);
    return null;
  }
}
