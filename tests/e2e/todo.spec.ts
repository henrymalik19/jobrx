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

test("steps through a lane from an application, and approving goes on to the next", async ({ page }) => {
  // Newest first, as To do lists them: third, second, first.
  const first = await seed.application("first", "queued");
  const second = await seed.application("second", "queued");
  const third = await seed.application("third", "queued");
  await page.goto("/app/todo?tab=ready");
  await page.getByRole("row").filter({ hasText: second.title }).getByRole("link", { name: second.title }).click();
  const title = page.getByRole("heading", { level: 1 });
  await expect(title).toHaveText(second.title);

  const nav = page.getByRole("navigation", { name: "Step through Ready to approve" });
  await nav.getByRole("link", { name: "Next" }).click();
  await expect(title).toHaveText(first.title);
  // The keyboard steps too.
  await page.keyboard.press("ArrowLeft");
  await expect(title).toHaveText(second.title);
  await page.keyboard.press("ArrowLeft");
  await expect(title).toHaveText(third.title);

  // Approving goes on to the next one in the lane, as it is now.
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(title).toHaveText(second.title);
  await expect.poll(() => seed.status(third.id)).toBe("approved");
  await expect(page).toHaveURL(/from=todo&tab=ready/);

  // Esc goes back to the list.
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/app\/todo\?tab=ready$/);
});

test("keeps its place in Missing answers once its answers move it on", async ({ page }) => {
  // Listed third, second, first; each with a question to answer (with none, it would move on by itself).
  const first = await seed.application("first", "needs_input");
  const second = await seed.application("second", "needs_input");
  const third = await seed.application("third", "needs_input");
  const { error } = await db.from("application_questions").insert(
    [first, second, third].map((a) => ({ application_id: a.id, question: "Why us?", field_name: "question_1", field_type: "text", required: true, bucket: "needs_user", sort_order: 0 })),
  );
  expect(error).toBeNull();
  await page.goto("/app/todo?tab=answers");
  await page.getByRole("row").filter({ hasText: second.title }).getByRole("link", { name: second.title }).click();
  const title = page.getByRole("heading", { level: 1 });
  await expect(title).toHaveText(second.title);

  // Its last answer moves it to Ready to approve, as answering on the page does.
  const moved = await db.rpc("transition_application", { p_application_id: second.id, p_to: "queued", p_cause: "user:answer", p_detail: null });
  expect(moved.error).toBeNull();
  await page.reload();
  const nav = page.getByRole("navigation", { name: "Step through Missing answers" });
  await expect(nav).toContainText("left");
  await nav.getByRole("link", { name: "Next" }).click();
  await expect(title).toHaveText(first.title);
  await page.keyboard.press("ArrowLeft");
  // The one it left is no longer in the lane: back from the first goes to the third.
  await expect(title).toHaveText(third.title);
});

test("on a phone: the lanes are a list to pick from, the page scrolls, and Decide comes first", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const first = await seed.application("phone", "queued");
  await page.goto("/app/todo?tab=ready");
  const lanes = page.getByRole("combobox", { name: "To do lanes" });
  await expect(lanes).toBeVisible();
  await expect(page.getByRole("navigation", { name: "To do lanes" })).toBeHidden();
  // The list doesn't scroll inside a box: the page does.
  const box = await page.locator("table").first().evaluate((t) => ({ scroll: t.parentElement!.scrollHeight, shown: t.parentElement!.clientHeight }));
  expect(box.scroll).toBeLessThanOrEqual(box.shown + 1);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/todo-phone.png` });

  await lanes.selectOption("/app/todo?tab=emails");
  await expect(page).toHaveURL(/tab=emails/);

  await page.goto(`/app/applications/${first.id}?from=todo&tab=ready`);
  const decide = page.getByRole("button", { name: "Approve" });
  await expect(decide).toBeVisible();
  // Above the questions, near the top.
  expect((await decide.boundingBox())!.y).toBeLessThan(844 * 1.5);
  // Its title bar isn't pinned on a phone: it scrolls away with the page.
  const position = await page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) }).evaluate((h) => getComputedStyle(h).position);
  expect(position).toBe("static");
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/application-phone.png` });
});
