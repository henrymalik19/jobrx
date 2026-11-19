// Profile on a phone: one box finds or adds a skill, Save stays in reach on a long form, and folded sections and
// jobs read clearly.
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { E2E_USER, localAdmin } from "./local";

const db = localAdmin();

test("on a phone: find or add a skill in one box", async ({ page }) => {
  const name = `Zigtest${randomUUID().slice(0, 6)}`;
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/app/profile?tab=skills");
    const box = page.getByRole("textbox", { name: "Find or add a skill" });
    await box.fill(name);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Added.")).toBeVisible();
    await expect(box).toHaveValue("");
    // Typing filters the list.
    await box.fill(name.slice(0, 7));
    await expect(page).toHaveURL(new RegExp(`q=${name.slice(0, 7)}`));
    await expect(page.getByText(name).first()).toBeVisible();
  } finally {
    const { data } = await db.from("skills").select("id").eq("name", name);
    if (data?.length) await db.from("profile_skills").delete().eq("user_id", E2E_USER.id).in("skill_id", data.map((s) => s.id));
  }
});

test("on a phone: Save stays in reach, and folded sections say what they hold", async ({ page }) => {
  const { data: job } = await db.from("employments").insert({ user_id: E2E_USER.id, employer: "E2E Co", title: "Engineer", start_date: "2021-02-01", is_current: true, sort_order: 0 }).select("id").single();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/app/profile");
    // Partway down the long form, its Save is on screen.
    await page.getByLabel("Postal code").scrollIntoViewIfNeeded();
    const save = page.getByRole("button", { name: "Save profile" });
    const box = (await save.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    await expect(page.getByLabel("State")).toHaveAttribute("placeholder", "e.g. TX");
    if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/profile-basics-sticky.png` });

    await page.goto("/app/profile?tab=experience");
    await expect(page.getByText("Add what you did there")).toBeVisible();
    if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/profile-experience-after.png` });
  } finally {
    if (job) await db.from("employments").delete().eq("id", job.id);
  }
});
