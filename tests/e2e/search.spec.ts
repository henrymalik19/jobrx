// Search: in the order a job goes through, with target roles and scoring saved from their own cards (saving one
// keeps the other as it is).
import { expect, test } from "@playwright/test";
import { E2E_USER, localAdmin } from "./local";

const db = localAdmin();

test("saves target roles and scoring separately, each keeping the other", async ({ page }) => {
  const { data: before } = await db.from("match_criteria").select("*").eq("user_id", E2E_USER.id).maybeSingle();
  await db.from("match_criteria").upsert({ ...(before ?? {}), user_id: E2E_USER.id, roles: ["Staff Engineer"], threshold: 60 });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/app/search");
    for (const heading of ["What you're looking for", "Which postings get saved", "How saved jobs are scored", "Checking your filters"]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
    await expect(page.getByText("LinkedIn search").first()).toBeVisible();
    if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/search-phone.png` });

    // Scoring saved: the roles stay.
    await page.getByLabel("Match threshold (0–100)").fill("72");
    await page.getByRole("button", { name: "Save criteria" }).click();
    await expect(page.getByText(/Saved\. New jobs are matched/)).toBeVisible();
    const after = async () => (await db.from("match_criteria").select("roles, threshold").eq("user_id", E2E_USER.id).single()).data;
    expect(await after()).toEqual({ roles: ["Staff Engineer"], threshold: 72 });

    // A role removed and saved: the threshold stays.
    await page.getByRole("button", { name: /Remove Staff Engineer/ }).click();
    await page.getByRole("button", { name: "Save roles" }).click();
    await expect(page.getByText(/Saved\. Scoring and the next LinkedIn search/)).toBeVisible();
    expect(await after()).toEqual({ roles: [], threshold: 72 });
  } finally {
    if (before) await db.from("match_criteria").upsert(before);
    else await db.from("match_criteria").delete().eq("user_id", E2E_USER.id);
  }
});
